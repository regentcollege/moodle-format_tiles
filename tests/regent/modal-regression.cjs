const fs = require('node:fs');
const path = require('node:path');
const moodleRoot = process.argv[2];
if (!moodleRoot) throw new Error('Pass the Moodle source root as the first argument');
const pluginRoot = path.resolve(__dirname, '../..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const results = [];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(html, reject = false, delayed = false) {
    let rejectNext = reject;
    let release;
    const pending = delayed ? new Promise(resolve => {release = resolve;}) : Promise.resolve();
    const dom = new JSDOM(html, {url: 'http://127.0.0.1:8053', runScripts: 'outside-only'});
    dom.window.eval(fs.readFileSync(path.join(moodleRoot, 'public/lib/jquery/jquery-3.7.1.min.js'), 'utf8'));
    const $ = dom.window.jQuery;
    $.fn.ready = function(fn) { fn(); return this; };
    const errors = [], calls = [], modals = [];
    const create = async (type, options) => {
        calls.push({type, options});
        await pending;
        if (rejectNext) throw new Error('Synthetic render failure');
        const root = $('<div><div class="modal"><div class="modal-header"></div><div class="modal-body"></div></div></div>');
        root.appendTo(dom.window.document.body);
        const modal = {root, shows: 0, hides: 0, getRoot: () => root, getBody: () => root.find('.modal-body'),
            show() {this.shows++;}, hide() {this.hides++;}, setLarge() {}, setScrollable() {},
            setBody(html) {this.getBody().html(html);}};
        modals.push(modal);
        return modal;
    };
    const deferred = (...values) => $.Deferred().resolve(...values).promise();
    const modules = {
        jquery: $, 'core/modal': {create: options => create('default', options)},
        'core/modal_save_cancel': {create: options => create('save_cancel', options)},
        'core_course/events': {manualCompletionToggled: 'manual-completion-toggled'},
        'format_tiles/completion': {triggerCompletionChangedEvent() {}},
        'core/modal_events': {save: 'save', cancel: 'cancel', hidden: 'hidden'},
        'core/notification': {exception: e => {errors.push(e);}},
        'core/config': {wwwroot: 'http://127.0.0.1:8053', sesskey: 'synthetic-only'},
        'core/str': {get_string: () => deferred('Demo title')},
        'core/ajax': {call: args => args.map(() => deferred({icons: '{"star":"Star"}', status: true}))},
        'core/templates': {render: name => deferred(name.includes('icon_picker') ? '<div>Demo icons</div>' : name.includes('modal_header_btns') ? '<div class="embed-module-buttons"><button data-action="toggle-manual-completion">Complete</button><button class="other-control">Other</button></div>' : '<div>Demo body</div>'),
            runTemplateJS() {}},
        'core/fragment': {loadFragment: () => deferred('<p>Demo activity</p>', '')},
        'format_onetopic/oneline': {load() {}},
    };
    let exported;
    const resolve = name => {
        assert.notEqual(name, 'core/modal_factory', 'Removed factory must never load');
        assert.ok(name in modules, `Unexpected AMD dependency ${name}`);
        return modules[name];
    };
    const context = vm.createContext({window: dom.window, document: dom.window.document,
        navigator: dom.window.navigator, console, setTimeout() {}, clearTimeout() {},
        require: (names, callback) => callback(...names.map(resolve)),
        define: (...args) => {
            const factory = args.pop(), dependencies = args.pop(), exports = {};
            const result = factory(...dependencies.map(name => name === 'exports' ? exports : resolve(name)));
            exported = result || exports;
        }});
    function load(component, file) {
        vm.runInContext(fs.readFileSync(path.join(pluginRoot, `amd/build/${file}.min.js`), 'utf8'), context);
        return exported;
    }
    return {$, errors, calls, modals, load, release: () => release?.(), setReject: value => {rejectNext = value;}, close: () => dom.window.close()};
}
async function test(name, fn) {if (!/tiles/i.test(name)) return; await fn(); results.push({name, passed: true});}
const helpHtml = '<div class="format-onetopic"><div class="onetopic"><a class="iconwithhelp" data-helpwindow="demo">Help</a></div></div><div id="hw-demo" data-title="Demo"><!--<b>Demo body</b>--></div>';
const backgroundHtml = '<div class="backgroundpicker"><input id="color" value="#112233"><div class="backgroundpickerwindow" title="Demo" data-savelabel="Save"><input class="form-control" type="text"></div><a class="backgroundpickerselector">Pick</a></div>';
const stylesHtml = '<div id="onetopic-tabstyles"><textarea class="savecontrol"></textarea><a id="tabstylesetdefault">Edit</a></div><div id="onetopic-styleswindow" data-title="Demo"><input type="text" data-style="color"><a data-action="setstyles">Save</a><a data-action="cancelstyles">Cancel</a></div>';
const iconHtml = '<div id="page-content"><a data-tiles-action="launch-tiles-icon-picker" data-true-sectionid="9" data-section="1">Icon</a></div>';
const activityHtml = '<div id="format-tiles-js-config"></div><div id="page"><ul><li class="section main" data-section="1"><ul><li class="activity" data-cmid="7" data-contextid="8" data-title="Demo" data-modal="page"><a data-action="launch-tiles-cm-modal"><span class="modal-description">Description</span>Activity</a></li></ul></li></ul></div>';
(async () => {



    await test('Tiles icon picker uses native promise and reuses modal', async () => {
        const h = harness(iconHtml); h.load('tiles','edit_icon_picker').init(1,'course-view-tiles',false,10);
        h.$('[data-tiles-action]').trigger('click'); await flush(); assert.equal(h.modals[0].shows, 1);
        h.$('[data-tiles-action]').trigger('click'); await flush(); assert.equal(h.calls.length, 1); assert.equal(h.modals[0].shows, 2); h.close();
    });
    await test('Tiles activity modal opens and loads a synthetic page fragment', async () => {
        const h = harness(activityHtml); h.load('tiles','course_mod_modal').init(1,false,'course-view-tiles',0,false);
        h.$('[data-action]').trigger('click'); await flush(); assert.equal(h.modals[0].shows, 1);
        assert.equal(h.modals[0].getBody().text(), 'Demo activity'); assert.equal(h.modals[0].root.attr('id'), 'embed_mod_modal_7'); h.close();
    });
    for (const [component, file, html, init, click] of [
        ['onetopic','main',helpHtml,[0,{}],'[data-helpwindow]'],
        ['onetopic','onetopicbackground',backgroundHtml,['color'],null],
        ['onetopic','tabstyles',stylesHtml,[],null],
        ['tiles','edit_icon_picker',iconHtml,[1,'course-view-tiles',false,10],'[data-tiles-action]'],
        ['tiles','course_mod_modal',activityHtml,[1,false,'course-view-tiles',0,false],'[data-action]'],
    ]) await test(`${component}/${file} reports native-promise rejection`, async () => {
        const h = harness(html,true); h.load(component,file).init(...init); if (click) h.$(click).trigger('click');
        await flush(); assert.equal(h.errors.length,1); assert.match(h.errors[0].message,/Synthetic render failure/); h.close();
    });

    for (const [component, file, html, init, click] of [
        ['onetopic','main',helpHtml,[0,{}],'[data-helpwindow]'],
        ['onetopic','onetopicbackground',backgroundHtml,['color'],'.backgroundpickerselector'],
        ['onetopic','tabstyles',stylesHtml,[],'#tabstylesetdefault'],
        ['tiles','edit_icon_picker',iconHtml,[1,'course-view-tiles',false,10],'[data-tiles-action]'],
    ]) {
        await test(`${component}/${file} early double click shares delayed creation`, async () => {
            const h=harness(html,false,true);h.load(component,file).init(...init);
            h.$(click).trigger('click');h.$(click).trigger('click');await flush();
            assert.equal(h.calls.length,1);assert.equal(h.modals.length,0);
            h.release();await flush();assert.equal(h.modals.length,1);assert.ok(h.modals[0].shows>=1);
            assert.equal(h.errors.length,0);h.close();
        });
        await test(`${component}/${file} rejection permits later click retry`, async () => {
            const h=harness(html,true);h.load(component,file).init(...init);
            if(component==='tiles'||file==='main')h.$(click).trigger('click');await flush();
            assert.equal(h.errors.length,1);h.setReject(false);h.$(click).trigger('click');await flush();
            assert.equal(h.calls.length,2);assert.equal(h.modals.length,1);assert.ok(h.modals[0].shows>=1);h.close();
        });
    }
    for (const [file, html, args, click] of [
        ['onetopicbackground',backgroundHtml,['color'],'.backgroundpickerselector'],
        ['tabstyles',stylesHtml,[],'#tabstylesetdefault'],
    ]) {
        await test(`${file} init resolves the created modal`, async () => {
            const h=harness(html); const result=h.load('onetopic',file).init(...args);
            assert.equal(typeof result.then,'function'); assert.strictEqual(await result,h.modals[0]);
            assert.equal(h.calls.length,1); h.close();
        });
        await test(`${file} init stays pending until creation completes`, async () => {
            const h=harness(html,false,true); let settled=false;
            const result=h.load('onetopic',file).init(...args); result.then(()=>settled=true);
            h.$(click).trigger('click'); h.$(click).trigger('click'); await flush();
            assert.equal(settled,false); assert.equal(h.calls.length,1);
            h.release(); assert.strictEqual(await result,h.modals[0]); await flush();
            assert.equal(settled,true); assert.ok(h.modals[0].shows>=1); h.close();
        });
        await test(`${file} init handles rejection and keeps later retry available`, async () => {
            const h=harness(html,true); const result=h.load('onetopic',file).init(...args);
            assert.equal(typeof result.then,'function'); assert.strictEqual(await result,undefined);
            assert.equal(h.errors.length,1); h.setReject(false); h.$(click).trigger('click'); await flush();
            assert.equal(h.calls.length,2); assert.equal(h.modals.length,1);
            assert.ok(h.modals[0].shows>=1); h.close();
        });
    }
    for (const mode of ['restore', 'deliberate-move', 'unfocused-click', 'hidden', 'one-shot']) {
        await test(`Tiles completion focus guard ${mode}`, async () => {
            const h = harness(activityHtml);
            let visible = true;
            h.$.expr.pseudos.visible = () => visible;
            h.load('tiles', 'course_mod_modal').init(1, false, 'course-view-tiles', 0, false);
            h.$('[data-action="launch-tiles-cm-modal"]').trigger('click'); await flush(); await flush();
            const root = h.modals[0].root;
            const old = root.find('[data-action="toggle-manual-completion"]')[0];
            const other = root.find('.other-control')[0];
            assert.ok(old && other);
            if (mode !== 'unfocused-click') old.focus();
            h.$(old).trigger('click');
            const replacement = old.cloneNode(true); old.replaceWith(replacement);
            assert.equal(h.$('body')[0].ownerDocument.activeElement, h.$('body')[0]);
            if (mode === 'deliberate-move') other.focus();
            if (mode === 'hidden') visible = false;
            h.$(replacement).trigger('manual-completion-toggled');
            const active = replacement.ownerDocument.activeElement;
            if (mode === 'restore' || mode === 'one-shot') assert.equal(active, replacement);
            else if (mode === 'deliberate-move') assert.equal(active, other);
            else assert.equal(active, replacement.ownerDocument.body);
            if (mode === 'one-shot') {
                replacement.blur(); h.$(replacement).trigger('manual-completion-toggled');
                assert.equal(replacement.ownerDocument.activeElement, replacement.ownerDocument.body);
            }
            h.close();
        });
    }
    console.log(JSON.stringify({node: process.version, tests: results, passed: true},null,2));
})().catch(error => {console.error(error); process.exitCode = 1;});
