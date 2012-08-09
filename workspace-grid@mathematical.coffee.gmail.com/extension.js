// Sample extension code, makes clicking on the panel show a message
const Mainloop = imports.mainloop;
const St = imports.gi.St;

const Gettext = imports.gettext.domain('workspace-grid');
const _ = Gettext.gettext;

const Main = imports.ui.main;

/** to import files from extension: polyglot
var Me;
try {
    Me = imports.ui.extensionSystem.extensions['workspace-grid@mathematical.coffee.gmail.com'];
} catch (err) {
    Me = imports.misc.extensionUtils.getCurrentExtension().imports;
}
*/

function _showHello() {
    let text = new St.Label({ style_class: 'helloworld-label', text: _("Hello, world!") });
    let monitor = Main.layoutManager.primaryMonitor;
    global.stage.add_actor(text);
    text.set_position(Math.floor (monitor.width / 2 - text.width / 2), Math.floor(monitor.height / 2 - text.height / 2));
    Mainloop.timeout_add(3000, function () { text.destroy(); });
}

// Put your extension initialization code here
function init(metadata) {
    // bind the workspace-grid@mathematical.coffee.gmail.com/locale dir to the translations
    imports.gettext.bindtextdomain('workspace-grid', GLib.build_filenamev([metadata.path, 'locale']));
}

let signalId;

function enable() {
    Main.panel.actor.reactive = true;
    signalId = Main.panel.actor.connect('button-release-event', _showHello);
}

function disable() {
    if (signalId) {
        Main.panel.actor.disconnect(signalId);
        signalId = 0;
    }
}
