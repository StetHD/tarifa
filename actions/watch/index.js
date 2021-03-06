var Q = require('q'),
    path = require('path'),
    fs = require('q-io/fs'),
    EventEmitter = require('events').EventEmitter,
    format = require('util').format,
    chalk = require('chalk'),
    cool = require('cool-ascii-faces'),
    argsHelper = require('../../lib/helper/args'),
    collectionsHelper = require('../../lib/helper/collections'),
    pathHelper = require('../../lib/helper/path'),
    builder = require('../../lib/builder'),
    feature = require('../../lib/feature'),
    log = require('../../lib/helper/log'),
    isAvailableOnHost = require('../../lib/cordova/platforms').isAvailableOnHost,
    runAction = require('../run'),
    buildAction = require('../build'),
    tarifaFile = require('../../lib/tarifa-file'),
    settings = require('../../lib/settings'),
    askHostIp = require('./helper/askip'),
    watchFile = require('./helper/watchFile'),
    startLiveReloadServer = require('./helper/reloadServer'),
    startHttpServer = require('./helper/httpServer'),
    prepare = require('./helper/prepare'),
    triggerLR = require('./helper/triggerLiveReload'),
    findPorts = require('./helper/findPorts');

function sigint(ƒ) {
    var d = Q.defer();
    process.openStdin().on('keypress', function(chunk, key) {
        if(key && key.name === 'c' && key.ctrl) {
            Q.delay(2000).then(function () {
                ƒ();
                d.resolve();
            });
        }
    });
    process.stdin.setRawMode();
    process.on('SIGINT', function() {
        Q.delay(200).then(function () {
            ƒ();
            d.resolve();
        });
    });
    return d.promise;
}

function setup(localSettings, httpPort) {
    return builder.checkWatcher(pathHelper.root()).then(function () {
        return askHostIp().then(function (ip) {
            return Q.all([
                Q(ip),
                findPorts(ip, settings.livereload_port, settings.livereload_range, 1),
                findPorts(ip, httpPort, 1, 1)
            ]);
        });
    });
}

function start (platform, localSettings, config, opts) {
    return function (ip, lrPorts, httpPorts) {
        var p = (!opts.nolivereload ? startLiveReloadServer(lrPorts[0]) : Q());
        return p.then(function () {
            return startHttpServer(
                !opts.nolivereload ? lrPorts[0] : null,
                httpPorts[0],
                platform
            );
        }).then(function () {
            var msg = {
                localSettings: localSettings,
                platform: platform,
                configuration: config,
                watch: format('http://%s:%s/www/index.html', ip, httpPorts[0])
            };

            if(platform === 'browser' && !opts.norun) return buildAction.buildƒ(msg);
            else return opts.norun ? Q(msg) : runAction.runƒ(msg);
        }).then(function (msg) {
            log.send('success', 'watch %s at %s', platform, chalk.green.underline(msg.watch));
            return [
                localSettings,
                platform,
                config,
                ip,
                lrPorts[0],
                httpPorts[0],
                opts.nolivereload
            ];
        });
    };
}

function run(platform, config, opts) {
    return function (localSettings) {
        return setup(localSettings, opts.httpPort)
            .spread(start(platform, localSettings, config, opts));
    };
}

function onWatcherError(filePath) {
    return function (err) {
        log.send('error', err);
        log.send('error', 'error watching %s', filePath);
    };
}

function logTime(t0) {
    return function () {
        var t = (new Date()).getTime();
        log.send('info', '\n\t%s', chalk.green(cool()));
        log.send('info', chalk.magenta('\ndone in ~ %ds\n'), Math.floor((t - t0) / 1000));
    };
}

function trigger(localSettings, platform, config, ip, httpPort, lrPort, nolr) {
    return function (filePath) {
        log.send('success', 'www project triggering tarifa');
        var t0 = (new Date()).getTime(),
            www = pathHelper.cordova_www(),
            out = localSettings.project_output;

        return prepare(www, out, localSettings, platform, config).then(function () {
            if(!nolr)
                return triggerLR(ip, httpPort, lrPort, out, filePath).then(logTime(t0));
            else return Q();
        });
    };
}

function onChange(root, platform, config, currentConf, confEmitter) {
    return function () {
        tarifaFile.parse(root, platform, config).then(function (changedSettings) {
            var changedConf = changedSettings.configurations[platform][config];
            if (!collectionsHelper.objectEqual(currentConf, changedConf)) {
                currentConf = changedConf;
                confEmitter.emit('change', changedConf);
            }
        });
    };
}

function wait(localSettings, platform, config, ip, lrPort, httpPort, nolr) {
    var root = pathHelper.root(),
        tarifaFilePath = path.join(root, settings.publicTarifaFileName),
        tarifaPrivatePath = path.join(root, settings.privateTarifaFileName);

    return Q.all([
        watchFile(tarifaFilePath), watchFile(tarifaPrivatePath)
    ]).spread(function (tarifaFileWatch, tarifaPrivateWatch) {

        tarifaFileWatch.on('error', onWatcherError(tarifaFilePath));
        tarifaPrivateWatch.on('error', onWatcherError(tarifaPrivatePath));

        var confEmitter = new EventEmitter(),
            closeBuilderWatch = builder.watch(
                pathHelper.root(),
                trigger(localSettings, platform, config, ip, httpPort, lrPort, nolr),
                localSettings,
                platform,
                config,
                confEmitter
            );

        setTimeout(function () {
            var currentConf = localSettings.configurations[platform][config];
            tarifaFileWatch.on('change', onChange(root, platform, config, currentConf, confEmitter));
            tarifaPrivateWatch.on('change', onChange(root, platform, config, currentConf, confEmitter));
        }, 1000);

        return [ tarifaFileWatch, tarifaPrivateWatch, closeBuilderWatch ];
    });
}

function closeWatchers(tarifaFileWatch, tarifaPrivateWatch, closeBuilderWatch) {
    return sigint(function () {
        log.send('success', 'closing www builder');
        tarifaFileWatch.close();
        tarifaPrivateWatch.close();
        closeBuilderWatch();
    });
}

function watch(platform, config, opts) {
    if (!feature.isAvailable('watch', platform)) {
        return Q.reject(format('feature not available on %s!', platform));
    }

    return Q.all([
        tarifaFile.parse(pathHelper.root(), platform, config),
        isAvailableOnHost(platform)
    ]).spread(run(platform, config, opts))
      .spread(wait)
      .spread(closeWatchers);
}

var action = function (argv) {
    var helpOpt = argsHelper.matchSingleOption(argv, 'h', 'help'),
        norun = argsHelper.matchOptionWithValue(argv, 'norun'),
        nolivereload = argsHelper.matchOptionWithValue(argv, 'nolivereload'),
        httpPort = settings.default_http_port;

    if (!helpOpt && argsHelper.matchArgumentsCount(argv, [1, 2]) &&
            argsHelper.checkValidOptions(argv, ['p', 'port', 'norun', 'nolivereload'])) {

        if (argsHelper.matchOptionWithValue(argv, 'p', 'port')) {
            httpPort = parseInt(argv.p || argv.port, 10);
            if (isNaN(httpPort)) {
                log.send('error', 'httpPort `%s` is not valid', argv.port === true ? '' : argv.port);
                return fs.read(path.join(__dirname, 'usage.txt')).then(console.log);
            }
        }

        return watch(argv._[0], argv._[1] || 'default', {
            nolivereload: nolivereload,
            norun: norun,
            httpPort: httpPort
        });
    }

    return fs.read(path.join(__dirname, 'usage.txt')).then(console.log);
};

module.exports = action;
