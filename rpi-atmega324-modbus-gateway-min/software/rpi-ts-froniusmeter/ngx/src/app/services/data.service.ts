import { Injectable, isDevMode } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { Observable, Subscriber, TeardownLogic, of } from 'rxjs';

import { IFroniusMeterValues } from '../server/fronius-meter-values';
import { IMonitorRecordData, MonitorRecord, IHeatpumpMode } from '../server/monitor-record';
import * as froniusSymo from '../server/fronius-symo-values';
import * as nibe1155 from '../server/nibe1155-values';

@Injectable({ providedIn: 'root' })
export class DataService {

    public froniusMeterObservable: Observable<IFroniusMeterValues>;
    public monitorObservable: Observable<MonitorRecord>;

    private _serverUri: string;

    private _froniusMeterSubject: Subject<IFroniusMeterValues>;
    private _froniusMeterObservers: Subscriber<IFroniusMeterValues> [] = [];
    private _froniusMeterTimer: any;
    private _froniusMeterValues: IFroniusMeterValues [] = [];

    private _monitorSubject: Subject<MonitorRecord>;
    private _monitorObservers: Subscriber<MonitorRecord> [] = [];
    private _monitorTimer: any;
    private _monitorValues: MonitorRecord [] = [];

    private _nibe1155: IHeatpumpData;


    constructor (private http: HttpClient) {
        this._serverUri = isDevMode() ? 'http://192.168.1.201:80' : '';
        this.froniusMeterObservable = new Observable((s) => this.froniusMeterSubscriber(s));
        this.monitorObservable = new Observable((s) => this.monitorSubscriber(s));
        this._nibe1155 = null;
    }

    public getFroniusMeterValues (): IFroniusMeterValues [] {
        return this._froniusMeterValues;
    }

    public getFroniusSymoValues ( query?: {
                                    all?:               boolean,
                                    froniusregister?:   boolean,
                                    common?:            boolean,
                                    inverter?:          boolean,
                                    nameplate?:         boolean,
                                    setting?:           boolean,
                                    status?:            boolean,
                                    control?:           boolean,
                                    storage?:           boolean,
                                    inverterExtension?: boolean,
                                    stringCombiner?:    boolean,
                                    meter?:             boolean
                                }): Observable<froniusSymo.IFroniusSymoValues> {
        let uri = this._serverUri + '/data/froniussymo';
        let first = true;
        for (const att in query) {
            if (!query.hasOwnProperty(att)) { continue; }
            uri += first ? '?' + att : '&' + att;
            first = false;
        }
        return this.http.get<froniusSymo.IFroniusSymoValues>(uri);
    }

    public getNibe1155Values ( query?: {
                                controller?: boolean;
                                completeValues?: boolean;
                                ids?: number [];
                            }): Observable<nibe1155.INibe1155Values> {
        let uri = this._serverUri + '/data/nibe1155';
        query = query || {};
        uri += '?' + (query.completeValues ? 'completeValues=true&simpleValues=false' :
                                                  'completeValues=false&simpleValues=true');
        uri += '&controller=' + (query.controller ? 'true' : 'false');
        if (Array.isArray(query.ids)) {
            for (const id of query.ids) {
                if (id >= 0 && id <= 0xffff) {
                    uri += '&id=' + id;
                }
            }
        }
        console.log(uri);
        return this.http.get<nibe1155.INibe1155Values>(uri);
    }


    public getMonitorData ( query?: { latest?: boolean }): Observable<IMonitorRecordData []> {
        let uri = this._serverUri + '/data/monitor';
        let first = true;
        for (const att in query) {
            if (!query.hasOwnProperty(att)) { continue; }
            uri += first ? '?' + att : '&' + att;
            first = false;
        }
        return this.http.get<IMonitorRecordData []>(uri);
    }

    public get nibe1155 (): IHeatpumpData {
        return this._nibe1155;
    }

    public handleNibe1155Values (v: nibe1155.INibe1155Values, clear?: boolean) {
        if (!v) { return; }
        if (clear) {
            this._nibe1155 = {
                lastRefreshAt: null,
                controller: null,
                values: {},
                logsetIds: [],
                nonLogsetIds: []
            };

            if (Array.isArray(v.logsetIds)) {
                this._nibe1155.logsetIds = [].concat(v.logsetIds);
            } else {
                console.log(new Error('unexpected response, missing logsetIds'));
            }
            if (v.completeValues) {
                for (const id in v.completeValues) {
                    if (!v.completeValues.hasOwnProperty(id)) { continue; }
                    if (!Array.isArray(this._nibe1155.logsetIds) || !this._nibe1155.logsetIds.find( (i) => i === +id)) {
                        this._nibe1155.nonLogsetIds.push(+id);
                    }
                }
            }
            // console.log(this._nibe1155.logsetIds);
            // console.log(this._nibe1155.nonLogsetIds);
        }

        this._nibe1155.lastRefreshAt = new Date();
        if (v.controller) {
            this._nibe1155.controller = v.controller;
        }
        if (v.completeValues) {
            let cnt = 0;
            for (const id in v.completeValues) {
                if (!v.completeValues.hasOwnProperty(id)) { continue; }
                this._nibe1155.values[id] = nibe1155.Nibe1155Value.createInstance(v.completeValues[id]);
                cnt++;
            }
            // console.log(cnt + ' completeValues defined');
        }
        if (v.simpleValues) {
            let cnt = 0;
            for (const id in v.simpleValues) {
                if (!v.simpleValues.hasOwnProperty(id)) { continue; }
                const x = this._nibe1155.values[+id];
                if (!x) {
                    console.log(new Error('missing complete value for simpleValue id ' + id));
                } else {
                    x.setRawValue(v.simpleValues[id].rawValue, new Date(v.simpleValues[id].rawValueAt));
                    cnt++;
                }
            }
            // console.log(cnt + ' simpleValues updated');
        }
    }


    public setHeatPumpMode (mode: IHeatpumpMode): Observable<IHeatpumpMode> {
        console.log(mode);
        const uri = this._serverUri + '/control/heatpumpmode';
        return this.http.post<IHeatpumpMode>(uri, mode, {});
    }

    private froniusMeterSubscriber (subscriber: Subscriber<IFroniusMeterValues>): TeardownLogic {
        const thiz = this;

        this._froniusMeterObservers.push(subscriber);
        if (this._froniusMeterObservers.length === 1) {
            this._froniusMeterTimer = setInterval( () => this.refreshFroniusMeterValues(), 1000);
        }
        return { unsubscribe() {
            thiz._froniusMeterObservers.splice(thiz._froniusMeterObservers.indexOf(subscriber), 1);
            if (thiz._froniusMeterObservers.length === 0) {
                clearInterval(thiz._froniusMeterTimer);
                thiz._froniusMeterTimer = null;
                thiz._froniusMeterValues = [];
            }
        } };
    }

    private refreshFroniusMeterValues () {
        // console.log('refresh ... ' + this._froniusMeterObservers.length);
        this.http.get(this._serverUri + '/data/froniusmeter').subscribe( (v: IFroniusMeterValues) => {
            // console.log(v);
            this._froniusMeterObservers.forEach( (o) => o.next(v));
            this._froniusMeterValues.push(v);
            if (this._froniusMeterValues.length > 60) {
                this._froniusMeterValues.splice(0, 1);
            }
        }, (error) => {
            console.log(error);
            this._froniusMeterObservers.forEach( (o) => o.next(null));
        });
    }


    private monitorSubscriber (subscriber: Subscriber<MonitorRecord>): TeardownLogic {
        const thiz = this;
        this._monitorObservers.push(subscriber);
        if (this._monitorObservers.length === 1) {
            this._monitorTimer = setInterval( () => this.refreshMonitorValues(), 1000);
            this.refreshMonitorValues();
        }
        return { unsubscribe() {
            thiz._monitorObservers.splice(thiz._monitorObservers.indexOf(subscriber), 1);
            if (thiz._monitorObservers.length === 0) {
                clearInterval(thiz._monitorTimer);
                thiz._monitorTimer = null;
                thiz._monitorValues = [];
            }
        } };
    }

    private refreshMonitorValues () {
        if (this._nibe1155 === null) {
            this.getNibe1155Values({ controller: true, completeValues: true }).subscribe( (values) => {
                this.handleNibe1155Values(values, true);
            }, (error) => {
                console.log(error);
            });
        }

        this.http.get(this._serverUri + '/data/monitor').subscribe( (v: IMonitorRecordData) => {
            if (!Array.isArray(v) || v.length !== 1) {
                console.log(new Error('unexpected response'));
                this._monitorObservers.forEach( (o) => o.next(null));
                return;
            }
            this.handleNibe1155Values(v[0].heatpump);
            const r = MonitorRecord.createFromRawData(v[0]);
            this._monitorObservers.forEach( (o) => o.next(r));
            this._monitorValues.push(r);
            if (this._monitorValues.length > 60) {
                this._monitorValues.splice(0, 1);
            }
        }, (error) => {
            console.log(error);
            this._monitorObservers.forEach( (o) => o.next(null));
        });
    }

    private handleNibe1155LogsetIds () {
        this._nibe1155.lastRefreshAt = new Date();
        const x: { [ key: string ]: string } = {};
        if (Array.isArray(this._nibe1155.logsetIds)) {
            for (const id of this._nibe1155.logsetIds) {
                const v = this._nibe1155.values[id];
                if (!v) {
                    x['? (' + id + ')'] = '?';
                } else {
                    x[v.label + ' (' + v.id + ')'] = v.valueAsString(true);
                }
            }
        }
    }

}

export interface IHeatpumpData {
    lastRefreshAt: Date;
    controller: nibe1155.INibe1155Controller;
    values: { [ id: number ]: nibe1155.Nibe1155Value }
    logsetIds: number [];
    nonLogsetIds: number [];
}
