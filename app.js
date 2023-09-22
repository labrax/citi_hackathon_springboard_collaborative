#!/usr/bin/env node

/*
 *       .                             .o8                     oooo
 *    .o8                             "888                     `888
 *  .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
 *    888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
 *    888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
 *    888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
 *    "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 *  ========================================================================
 *  Updated:    5/11/22 2:26 AM
 *  Copyright (c) 2014-2022 Trudesk, Inc. All rights reserved.
 */

const async = require('async')
const path = require('path')
const fs = require('fs')
const winston = require('./src/logger')
const nconf = require('nconf')
const Chance = require('chance')
const chance = new Chance()
const pkg = require('./package.json')
// `const memory = require('./src/memory');

const isDocker = process.env.TRUDESK_DOCKER || false

global.forks = []

nconf.argv().env()

global.env = process.env.NODE_ENV || 'development'

if (!process.env.FORK) {
  winston.info('                                                            ')
  winston.info('\\_| |_/\\__,_|\\___|_|\\_\\__,_|\\__|_| |_|\\___/|_| |_|          ')
  winston.info('| | | | (_| | (__|   < (_| | |_| | | | (_) | | | |          ')
  winston.info('|  _  |/ _` |/ __| |/ / _` | __| \'_ \\ / _ \\| \'_ \\           ')
  winston.info('| |_| | __ _  ___| | ____ _| |_| |__   ___  _ __            ')
  winston.info('| | | |          | |       | | | |                          ')
  winston.info(' _   _            \\____/\\___/|_|_|\\___|\\___|\\__|_| \\_/ \\___|')
  winston.info('                 | \\__/\\ (_) | | |  __/ (__| |_| |\\ V /  __/')
  winston.info('                 | |    / _ \\| | |/ _ \\/ __| __| \\ \\ / / _ \\')
  winston.info('                 | /  \\/ ___ | | | ___  ___| |_ ___   _____ ')
  winston.info('                 /  __ \\     | | |         | | (_)          ')
  winston.info('      |_|         _____   |___/ _           _   _           ')
  winston.info('      | |                  __/ |                            ')
  winston.info('\\____/| .__/|_|  |_|_| |_|\\__, \\____/ \\___/ \\__,_|_|  \\__,_|')
  winston.info('/\\__/ / |_) | |  | | | | | (_| | |_/ / (_) | (_| | | | (_| |')
  winston.info(' `--. \\ \'_ \\| \'__| | \'_ \\ / _` | ___ \\/ _ \\ / _` | \'__/ _` |')
  winston.info('\\ `--. _ __  _ __ _ _ __   __ _| |_/ / ___   __ _ _ __ __| |')
  winston.info('/  ___|          (_)           | ___ \\                   | |')
  winston.info(' _____            _            ______                     _ ')  
  // font from https://patorjk.com/software/taag/#p=display&v=2&f=Doom&t=SpringBoard%0A%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20Collective%0AHackathon
  winston.info('==========================================================================')
  winston.info('Solution based on - trudesk v' + pkg.version + '')
  winston.info('')
  winston.info('Running in: ' + global.env)
  winston.info('Server Time: ' + new Date())
}

let configFile = path.join(__dirname, '/config.yml')

if (nconf.get('config')) {
  configFile = path.resolve(__dirname, nconf.get('config'))
}

// Make sure we convert the .json file to .yml
checkForOldConfig()

const configExists = fs.existsSync(configFile)

function launchInstallServer () {
  // Load the defaults for the install server
  nconf.defaults({
    tokens: {
      secret: chance.hash() + chance.md5()
    }
  })

  const ws = require('./src/webserver')
  ws.installServer(function () {
    return winston.info('Install Server Running...')
  })
}

if (nconf.get('install') || (!configExists && !isDocker)) {
  launchInstallServer()
}

function loadConfig () {
  nconf.file({
    file: configFile,
    format: require('nconf-yaml')
  })

  // Must load after file
  nconf.defaults({
    base_dir: __dirname,
    tokens: {
      secret: chance.hash() + chance.md5(),
      expires: 900
    }
  })
}

function checkForOldConfig () {
  const oldConfigFile = path.join(__dirname, '/config.json')
  if (fs.existsSync(oldConfigFile)) {
    // Convert config to yaml.
    const content = fs.readFileSync(oldConfigFile)
    const YAML = require('yaml')
    const data = JSON.parse(content)

    fs.writeFileSync(configFile, YAML.stringify(data))

    // Rename the old config.json to config.json.bk
    fs.renameSync(oldConfigFile, path.join(__dirname, '/config.json.bk'))
  }
}

function start () {
  if (!isDocker) loadConfig()
  if (isDocker) {
    // Load some defaults for JWT token that is missing when using docker
    const jwt = process.env.TRUDESK_JWTSECRET
    nconf.defaults({
      tokens: {
        secret: jwt || chance.hash() + chance.md5(),
        expires: 900
      }
    })
  }

  const _db = require('./src/database')

  _db.init(function (err, db) {
    if (err) {
      winston.error('FETAL: ' + err.message)
      winston.warn('Retrying to connect to MongoDB in 10secs...')
      return setTimeout(function () {
        _db.init(dbCallback)
      }, 10000)
    } else {
      dbCallback(err, db)
    }
  })
}

function launchServer (db) {
  const ws = require('./src/webserver')
  ws.init(db, function (err) {
    if (err) {
      winston.error(err)
      return
    }

    async.series(
      [
        function (next) {
          require('./src/settings/defaults').init(next)
        },
        function (next) {
          require('./src/permissions').register(next)
        },
        function (next) {
          require('./src/elasticsearch').init(function (err) {
            if (err) {
              winston.error(err)
            }

            return next()
          })
        },
        function (next) {
          require('./src/socketserver')(ws)
          return next()
        },
        function (next) {
          // Start Check Mail
          const settingSchema = require('./src/models/setting')
          settingSchema.getSetting('mailer:check:enable', function (err, mailCheckEnabled) {
            if (err) {
              winston.warn(err)
              return next(err)
            }

            if (mailCheckEnabled && mailCheckEnabled.value) {
              settingSchema.getSettings(function (err, settings) {
                if (err) return next(err)

                const mailCheck = require('./src/mailer/mailCheck')
                winston.debug('Starting MailCheck...')
                mailCheck.init(settings)

                return next()
              })
            } else {
              return next()
            }
          })
        },
        function (next) {
          require('./src/migration').run(next)
        },
        function (next) {
          winston.debug('Building dynamic sass...')
          require('./src/sass/buildsass').build(next)
        },
        // function (next) {
        //   // Start Task Runners
        //   require('./src/taskrunner')
        //   return next()
        // },
        function (next) {
          const cache = require('./src/cache/cache')
          if (isDocker) {
            cache.env = {
              TRUDESK_DOCKER: process.env.TRUDESK_DOCKER,
              TD_MONGODB_SERVER: process.env.TD_MONGODB_SERVER,
              TD_MONGODB_PORT: process.env.TD_MONGODB_PORT,
              TD_MONGODB_USERNAME: process.env.TD_MONGODB_USERNAME,
              TD_MONGODB_PASSWORD: process.env.TD_MONGODB_PASSWORD,
              TD_MONGODB_DATABASE: process.env.TD_MONGODB_DATABASE,
              TD_MONGODB_URI: process.env.TD_MONGODB_URI
            }
          }

          cache.init()

          return next()
        },
        function (next) {
          const taskRunner = require('./src/taskrunner')
          return taskRunner.init(next)
        }
      ],
      function (err) {
        if (err) throw new Error(err)

        ws.listen(function () {
          winston.info('webservice Ready')
        })
      }
    )
  })
}

function dbCallback (err, db) {
  if (err || !db) {
    return start()
  }

  if (isDocker) {
    const s = require('./src/models/setting')
    s.getSettingByName('installed', function (err, installed) {
      if (err) return start()

      if (!installed) {
        return launchInstallServer()
      } else {
        return launchServer(db)
      }
    })
  } else {
    return launchServer(db)
  }
}

if (!nconf.get('install') && (configExists || isDocker)) start()
