import { createClient } from "webdav";
import type {
    WebDAVClientOptions,
    CreateReadStreamOptions,
    CreateWriteStreamOptions,
    FileStat,
    BufferLike
} from "webdav";

const TYPE_KEY = "@@fsType";

type PathLike = string;
type CallbackType = (error: any, obj?: any) => any;
interface ExtCreateReadStreamOptions extends CreateReadStreamOptions {
    start?: number;
    end?: number;
}

function __convertStat(data: FileStat) {
    return {
        isDirectory: function() {
            return data.type === "directory";
        },
        isFile: function() {
            return data.type === "file";
        },
        mtime: new Date(data.lastmod).getTime(),
        name: data.basename,
        size: data.size || 0
    };
}

function __executeCallbackAsync(callback: Function, ...args: any[]) {
    if (typeof setImmediate !== "undefined") {
        setImmediate(function() {
            callback.apply(null, ...args);
        });
    } else {
        setTimeout(function() {
            callback.apply(null, ...args);
        }, 0);
    }
}

/**
 * Options for createReadStream
 * @typedef {Object} CreateReadStreamOptions
 * @property {Number=} start - Byte index to start the range at (inclusive)
 * @property {Number=} end - Byte index to end the range at (inclusive)
 * @property {Object=} headers - Optionally override the headers
 */

/**
 * Options for createWriteStream
 * @typedef {Object} CreateWriteStreamOptions
 * @property {Object=} headers - Optionally override the headers
 */

/**
 * Adapter options, which match to the underlying WebDAV-client API:
 *  {@link https://github.com/perry-mitchell/webdav-client/blob/master/API.md#module_WebDAV.createClient|WebDAV-Client API}
 * @typedef {Object} ClientOptions
 * @property {String=} username The username to use for authentication
 * @property {String=} password The password to use for authentication
 * @property {https.Agent=} httpsAgent Override for the HTTPS agent
 * @property {http.Agent=} httpAgent Override for the HTTP agent
 * @property {Object=} token Optional token override for OAuth
 */

/**
 * Create a new client adapter
 * @param {String} webDAVEndpoint The WebDAV server URL
 * @param {Object=} options Connection options for the client:
 *  {@link https://github.com/perry-mitchell/webdav-client/blob/master/API.md#module_WebDAV.createClient|WebDAV-Client API}
 */
function createWebDAVfs(webDAVEndpoint: string, options: WebDAVClientOptions = {}) {
    const client = createClient(webDAVEndpoint, options);
    return {
        // fs adapter type (for downstream integrations)
        [TYPE_KEY]: "webdav-fs",

        /**
         * Create a read stream for a remote file
         * @param {String} filePath The remote path
         * @param {CreateReadStreamOptions=} options Options for the stream
         * @returns {Readable} A readable stream
         */
        createReadStream: (filePath: PathLike, options: ExtCreateReadStreamOptions) => {
            var clientOptions: CreateReadStreamOptions = {};
            if (options && options !== null) {
                if (typeof options.headers === "object") {
                    clientOptions.headers = options.headers;
                }
                if (typeof options.start === "number") {
                    clientOptions.range = { start: options.start, end: options.end };
                }
            }
            return client.createReadStream(filePath, clientOptions);
        },

        /**
         * Create a write stream for a remote file
         * @param {String} filePath The remote path
         * @param {CreateWriteStreamOptions=} options Options for the stream
         * @returns {Writeable} A writeable stream
         */
        createWriteStream: function(filePath: PathLike, options: CreateWriteStreamOptions) {
            var clientOptions: CreateWriteStreamOptions = {};
            if (options && options !== null) {
                if (typeof options.headers === "object") {
                    clientOptions.headers = options.headers;
                }
            }
            return client.createWriteStream(filePath, clientOptions);
        },

        /**
         * Create a remote directory
         * @param {String} dirPath The remote path to create
         * @param {Function} callback Callback: function(error)
         */
        mkdir: function(dirPath: PathLike, callback: CallbackType) {
            client
                .createDirectory(dirPath)
                .then(function() {
                    __executeCallbackAsync(callback, [null]);
                })
                .catch(callback);
        },

        /**
         * Readdir processing mode.
         * When set to 'node', readdir will return an array of strings like Node's
         * fs.readdir does. When set to 'stat', readdir will return an array of stat
         * objects.
         * @see stat
         * @typedef {('node'|'stat')} ReadDirMode
         */

        /**
         * Read a directory synchronously.
         * Maps -> fs.readdir
         * @see https://nodejs.org/api/fs.html#fs_fs_readdir_path_callback
         * @param {String} path The path to read at
         * @param {String=} mode The readdir processing mode (default 'node')
         * @param {Function} callback Callback: function(error, files)
         */
        readdir: function(
            dirPath: PathLike,
            modeOrCallback: "node" | "stat" | CallbackType,
            callback?: CallbackType
        ) {
            let mode = typeof modeOrCallback === "string" ? modeOrCallback : "node";
            let callbackReal: CallbackType = function() {};
            if (typeof modeOrCallback === "function") {
                callbackReal = modeOrCallback;
            } else if (callback !== undefined && typeof callback == "function") {
                callbackReal = callback;
            }
            client
                .getDirectoryContents(dirPath)
                .then(function(contents: Array<FileStat>) {
                    var results;
                    if (mode === "node") {
                        results = contents.map(function(statItem) {
                            return statItem.basename;
                        });
                    } else if (mode === "stat") {
                        results = contents.map(__convertStat);
                    } else {
                        throw new Error("Unknown mode: " + mode);
                    }
                    __executeCallbackAsync(callbackReal, [null, results]);
                })
                .catch(callbackReal);
        },

        /**
         * Read the contents of a remote file
         * @param {String} filename The remote file path to read
         * @param {String=} encoding Optional file encoding to read (utf8/binary) (default: utf8)
         * @param {Function} callback Callback: function(error, contents)
         */
        readFile: function(
            filename: PathLike,
            encodingOrCallback: "utf8" | "text" | "binary" | CallbackType,
            callback?: CallbackType
        ) {
            let encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "text";
            let callbackReal: CallbackType = function() {};
            if (typeof encodingOrCallback === "function") {
                callbackReal = encodingOrCallback;
            } else if (callback !== undefined && typeof callback === "function") {
                callbackReal = callback;
            }
            encoding = encoding === "utf8" ? "text" : encoding;
            client
                .getFileContents(filename, { format: encoding })
                .then(function(data) {
                    __executeCallbackAsync(callbackReal, [null, data]);
                })
                .catch(callbackReal);
        },

        /**
         * Rename a remote item
         * @param {String} filePath The remote path to rename
         * @param {String} targetPath The new path name of the item
         * @param {Function} callback Callback: function(error)
         */
        rename: function(filePath: PathLike, targetPath: PathLike, callback: CallbackType) {
            client
                .moveFile(filePath, targetPath)
                .then(function() {
                    __executeCallbackAsync(callback, [null]);
                })
                .catch(callback);
        },

        /**
         * Remote remote directory
         * @todo Check if remote is a directory before removing
         * @param {String} targetPath Directory to remove
         * @param {Function} callback Callback: function(error)
         */
        rmdir: function(targetPath: PathLike, callback: CallbackType) {
            client
                .deleteFile(targetPath)
                .then(function() {
                    __executeCallbackAsync(callback, [null]);
                })
                .catch(callback);
        },

        /**
         * Stat a remote item
         * @param {String} remotePath The remote item to stat
         * @param {Function} callback Callback: function(error, stat)
         */
        stat: function(remotePath: PathLike, callback: CallbackType) {
            client
                .stat(remotePath)
                .then(function(stat) {
                    __executeCallbackAsync(callback, [null, __convertStat(stat as FileStat)]);
                })
                .catch(callback);
        },

        /**
         * Unlink (delete) a remote file
         * @param {String} targetPath The remote file path to delete
         * @param {Function} callback Callback: function(error)
         */
        unlink: function(targetPath: PathLike, callback: CallbackType) {
            client
                .deleteFile(targetPath)
                .then(function() {
                    __executeCallbackAsync(callback, [null]);
                })
                .catch(callback);
        },

        /**
         * Write data to a remote file
         * @param {String} filename The remote file path to write to
         * @param {Buffer|String} data The data to write
         * @param {String=} encoding Optional encoding to write as (utf8/binary) (default: utf8)
         * @param {Function} callback Callback: function(error)
         */
        writeFile: function(
            filename: PathLike,
            data: BufferLike | string,
            encodingOrCallback?: "utf8" | "text" | "binary" | CallbackType,
            callback?: CallbackType
        ) {
            let encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "text";
            let callbackReal: CallbackType = function() {};
            if (typeof encodingOrCallback === "function") {
                callbackReal = encodingOrCallback;
            } else if (callback !== undefined && typeof callback === "function") {
                callbackReal = callback;
            }
            encoding = encoding === "utf8" ? "text" : encoding;
            client
                .putFileContents(filename, data /*{ format: encoding }*/)
                .then(function() {
                    __executeCallbackAsync(callbackReal, [null]);
                })
                .catch(callbackReal);
        }
    };
}

export = createWebDAVfs;
