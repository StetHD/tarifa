var helpers = require('./helpers');

// unit tests
require('./unit/xml/config.xml');
require('./unit/xml/android/string.xml');
require('./unit/xml/android/project');
require('./unit/xml/android/AndroidManifest.xml');
require('./unit/xml/wp8/csproj');
require('./unit/xml/wp8/WMAppManifest.xml');
require('./unit/tarifa-file/extend_tests');
// cli tests by actions
require('./cli/noargs');
require('./cli/option-version');

// setting up 1 test project random names
helpers.projectValues();
// setting up 1 test plugin random names
helpers.pluginValues();

require('./cli/create');
require('./cli/prepare');
require('./cli/platform');
require('./cli/plugin');
require('./cli/build');
require('./cli/run');
require('./cli/info');
require('./cli/device');
require('./cli/config');
require('./cli/check');
require('./cli/clean');
require('./cli/hockeyapp');
require('./cli/update');
require('./cli/watch');
require('./cli/test');

helpers.cleanTest(process.cwd());
