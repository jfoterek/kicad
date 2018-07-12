
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

import * as nconf from 'nconf';
import * as cors from 'cors';
import * as morgan from 'morgan';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as jwt from 'jsonwebtoken';

import { handleError, RouterError, BadRequestError, AuthenticationError, NotFoundError } from './routers/router-error';
import { Auth } from './auth';
import { IUser, User } from './database/user';

// import { RouterData } from './routers/router-data';
// import { RouterRes } from './routers/router-res';
// import { RouterMd } from './routers/router-md';

// import { UserLogin, IUserLogin } from './client/user-login';
// import { IUserAuth } from './client/user-auth';

// import { Database } from './database/database';
// import { delayMillis } from './utils/util';

import * as debugsx from 'debug-sx';
const debug: debugsx.IDefaultLogger = debugsx.createDefaultLogger('server');

export class Server {

    private static _instance: Server;

    public static get Instance (): Server {
        if (Server._instance === undefined) {
            Server._instance = new Server();
        }
        return Server._instance;
    }

    // ************************************************

    private _express: express.Express;

    private constructor () {}

    public async start (port?: number): Promise<void> {
        if (port === undefined) {
            const configServer = nconf.get('server');
            if (configServer && configServer.port) {
                port = configServer.port;
            }
        }
        if (!(port >= 0 && port <= 0xffff)) {
            throw new Error('missing port, cannot start server, fix config.json');
        }

        this._express = express();
        this._express.set('views', path.join(__dirname, '/views'));
        const pugEngine = this._express.set('view engine', 'pug');
        pugEngine.locals.pretty = true;

        this._express.use(cors());
        this._express.use(morgan('tiny'));
        this._express.use(bodyParser.json());
        this._express.use(bodyParser.urlencoded({ extended: true }) );

        this._express.post('/auth', (req, res, next) => Auth.Instance.handlePostAuth(req, res, next));

        // this._express.use('/md', RouterMd.Instance);
        this._express.use('/node_modules', express.static(path.join(__dirname, '../node_modules')));
        this._express.use('/ngx', express.static(path.join(__dirname, '../../ngx/dist')));
        this._express.use('/assets', express.static(path.join(__dirname, '../../ngx/dist/assets')));
        // this._express.use('/res', RouterRes.routerInstance);

        this._express.get('/*', (req, res, next) => this.handleGet(req, res, next));
        this._express.use((req, res, next) => Auth.Instance.authorizeRequest(req, res, next));
        this._express.get('/auth', (req, res, next) => Auth.Instance.handleGetAuth(<any>req, res, next));
        this._express.get('/test', (req, res, next) => this.handleGetTest(<any>req, res, next));
        // this._express.use('/data', RouterData.Instance);

        this._express.use(
            (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => this.errorHandler(err, req, res, next)
        );

        const server = http.createServer(this._express).listen(port, () => {
            debug.info('Server gestartet: http://localhost:%s', port);
        });
        server.on('connection', socket => {
            debug.fine('Connection established: %s:%s', socket.remoteAddress, socket.remotePort);
            // socket.destroy();
        });
        server.on('close', () => {
            debug.info('Server gestoppt');
        });
        server.on('error', err => {
            debug.warn(err);
        });
    }

    private errorHandler (err: any, req: express.Request, res: express.Response, next: express.NextFunction) {
        const now = new Date();
        const ts = now.toISOString();
        debug.warn('Internal Server Error: %s\n%e', ts, err);
        if (req.headers.accept && req.headers.accept.indexOf('application/json') >= 0) {
            res.status(500).json({ error: 'Internal Server Error', ts: ts });
        } else {
            res.status(500).send('Internal Server Error (' + ts + ')');
        }
    }


    private handleGet (req: express.Request, res: express.Response,
                       next: express.NextFunction) {
        debug.info(req.url);

        if (req.url === '/' || req.url === '/index.html') {
            const indexFileName = path.join(__dirname, '../../ngx/dist/ngx/index.html');
            res.sendFile(indexFileName);
            return;
        }
        // if (req.url === '/' || req.url === '/index.html') {
        //     const ngAppFiles = [
        //         'styles.bundle.css', 'inline.bundle.js', 'polyfills.bundle.js', 'main.bundle.js', 'inline.bundle.js',
        //         'polyfills.bundle.js', 'main.bundle.js'
        //     ];
        //     for (const f of ngAppFiles) {
        //         const fn = path.join(__dirname, '..', '..', 'ngx', 'dist', f);
        //         try {
        //             fs.accessSync(fn, fs.constants.R_OK);
        //         } catch (err) {
        //             debug.warn('Angular app file ' + f + ' not found, cannot start application on client ' + req.socket.remoteAddress);
        //             res.render('ngerror.pug');
        //             return;
        //         }
        //     }
        //     res.render('ngmain.pug');
        //     return;
        // }
        if (req.url === '/favicon.ico') {
            const fileName = path.join(__dirname, '..', 'dist/public/favicon.ico');
            debug.info(fileName);
            res.sendFile(fileName);
            return;
        }
        if (req.url.startsWith('/ngx/')) {if (req.url === '/ngx/vendor.bundle.js') {
                debug.fine('/ngx/vendor.bundle.js not avilable, send empty response');
                res.end();
                return;
            }
            handleError(new NotFoundError(req.url + 'not found'), req, res, next, debug);
            return;
        }

        const fn = path.join(__dirname, '../../ngx/dist/ngx/', req.url);
        try {
            debug.info(fn);
            fs.accessSync(fn, fs.constants.R_OK);
            res.sendFile(fn);
            return;
        } catch (err) {
        }

        next();
    }


    private async handleGetTest (req: IAuthorizedRequest, res: express.Response, next: express.NextFunction) {
        try {
            res.json({});
            // throw new Error('Testerror');
            // throw new BadRequestError('Test', new Error('Cause'));
            // throw new NotFoundError('Test');
        } catch (err) {
            handleError(err, req, res, next, debug);
        }
    }


}

export interface IRequestUser {
    htlid: string;
    iat: number;
    exp: number;
    model: User;
}

export interface IRequestWithUser extends express.Request {
    user: IRequestUser;
}

interface IAuthorizedRequest extends express.Request {
    user: User;
}

