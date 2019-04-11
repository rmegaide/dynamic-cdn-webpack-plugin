'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _readPkgUp = require('read-pkg-up');

var _readPkgUp2 = _interopRequireDefault(_readPkgUp);

var _htmlWebpackIncludeAssetsPlugin = require('html-webpack-include-assets-plugin');

var _htmlWebpackIncludeAssetsPlugin2 = _interopRequireDefault(_htmlWebpackIncludeAssetsPlugin);

var _ExternalModule = require('webpack/lib/ExternalModule');

var _ExternalModule2 = _interopRequireDefault(_ExternalModule);

var _resolvePkg = require('resolve-pkg');

var _resolvePkg2 = _interopRequireDefault(_resolvePkg);

var _getResolver = require('./get-resolver');

var _getResolver2 = _interopRequireDefault(_getResolver);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const pluginName = 'dynamic-cdn-webpack-plugin';
let HtmlWebpackPlugin;
try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    HtmlWebpackPlugin = require('html-webpack-plugin');
} catch (err) {
    HtmlWebpackPlugin = null;
}

const moduleRegex = /^((?:@[a-z0-9][\w-.]+\/)?[a-z0-9][\w-.]*)/;

const getEnvironment = mode => {
    switch (mode) {
        case 'none':
        case 'development':
            return 'development';

        default:
            return 'production';
    }
};

class DynamicCdnWebpackPlugin {
    constructor({ disable = false, env, exclude, only, verbose, resolver } = {}) {
        if (exclude && only) {
            throw new Error('You can\'t use \'exclude\' and \'only\' at the same time');
        }

        this.disable = disable;
        this.env = env;
        this.exclude = exclude || [];
        this.only = only || null;
        this.verbose = verbose === true;
        this.resolver = (0, _getResolver2.default)(resolver);

        this.modulesFromCdn = {};
    }

    apply(compiler) {
        if (!this.disable) {
            this.execute(compiler, { env: this.env || getEnvironment(compiler.options.mode) });
        }

        const isUsingHtmlWebpackPlugin = HtmlWebpackPlugin != null && compiler.options.plugins.some(x => x instanceof HtmlWebpackPlugin);

        if (isUsingHtmlWebpackPlugin) {
            this.applyHtmlWebpackPlugin(compiler);
        } else {
            this.applyWebpackCore(compiler);
        }
    }

    execute(compiler, { env }) {
        compiler.hooks.normalModuleFactory.tap(pluginName, nmf => {
            nmf.hooks.factory.tap(pluginName, factory => async (data, cb) => {
                const modulePath = data.dependencies[0].request;
                const contextPath = data.context;

                const isModulePath = moduleRegex.test(modulePath);
                if (!isModulePath) {
                    return factory(data, cb);
                }

                const varName = await this.addModule(contextPath, modulePath, { env });

                if (varName === false) {
                    factory(data, cb);
                } else if (varName == null) {
                    cb(null);
                } else {
                    cb(null, new _ExternalModule2.default(varName, 'var', modulePath));
                }
            });
        });
    }

    async addModule(contextPath, modulePath, { env }) {
        const isModuleExcluded = this.exclude.includes(modulePath) || this.only && !this.only.includes(modulePath);
        if (isModuleExcluded) {
            return false;
        }

        const moduleName = modulePath.match(moduleRegex)[1];
        const { pkg: { version, peerDependencies } } = await (0, _readPkgUp2.default)({ cwd: (0, _resolvePkg2.default)(moduleName, { cwd: contextPath }) });

        const isModuleAlreadyLoaded = Boolean(this.modulesFromCdn[modulePath]);
        if (isModuleAlreadyLoaded) {
            const isSameVersion = this.modulesFromCdn[modulePath].version === version;
            if (isSameVersion) {
                return this.modulesFromCdn[modulePath].var;
            }

            return false;
        }

        const cdnConfig = await this.resolver(modulePath, version, { env });

        if (cdnConfig == null) {
            if (this.verbose) {
                console.log(`❌ '${modulePath}' couldn't be found, please add it to https://github.com/mastilver/module-to-cdn/blob/master/modules.json`);
            }
            return false;
        }

        if (this.verbose) {
            console.log(`✔️ '${cdnConfig.name}' will be served by ${cdnConfig.url}`);
        }

        if (peerDependencies) {
            const arePeerDependenciesLoaded = (await Promise.all(Object.keys(peerDependencies).map(peerDependencyName => {
                return this.addModule(contextPath, peerDependencyName, { env });
            }))).map(x => Boolean(x)).reduce((result, x) => result && x, true);

            if (!arePeerDependenciesLoaded) {
                return false;
            }
        }

        this.modulesFromCdn[modulePath] = cdnConfig;

        return cdnConfig.var;
    }

    applyWebpackCore(compiler) {
        compiler.hooks.afterCompile.tapAsync(pluginName, (compilation, cb) => {
            for (const [name, cdnConfig] of Object.entries(this.modulesFromCdn)) {
                compilation.addChunkInGroup(name);
                const chunk = compilation.addChunk(name);
                chunk.files.push(cdnConfig.url);
            }

            cb();
        });
    }

    applyHtmlWebpackPlugin(compiler) {
        const includeAssetsPlugin = new _htmlWebpackIncludeAssetsPlugin2.default({
            assets: [],
            publicPath: '',
            append: false
        });

        includeAssetsPlugin.apply(compiler);

        compiler.hooks.afterCompile.tapAsync(pluginName, (compilation, cb) => {
            const assets = Object.values(this.modulesFromCdn).map(moduleFromCdn => moduleFromCdn.url);

            // HACK: Calling the constructor directly is not recomended
            //       But that's the only secure way to edit `assets` afterhand
            includeAssetsPlugin.constructor({
                assets,
                publicPath: '',
                append: false
            });

            cb();
        });
    }
}
exports.default = DynamicCdnWebpackPlugin;