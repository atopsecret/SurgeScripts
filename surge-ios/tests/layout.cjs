// Node.js | 24+ | CommonJS
// Build: none; committed offline fixtures only.
// Run: required by the offline suites and run.mjs.
// Deps: Node.js built-ins only; no network or account access.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const publishRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(publishRoot, 'test-fixtures');
const remoteScriptPrefix = 'https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/surge-ios/scripts/';
const remoteModulePrefix = 'https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/surge-ios/modules/';
function fixtureJSON(name) {
    return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}
function loadModuleFixture(group) {
    return fixtureJSON(`${group}/modules.json`).modules.map(entry => ({
        ...entry,
        sgmodule: path.join(publishRoot, entry.sgmodule),
        scripts: (entry.scripts || []).map(script => ({
            ...script,
            sourcePath: path.join(publishRoot, script.sourcePath),
        })),
    }));
}
function sections(text) {
    const result = {};
    let active;
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\[([^\]]+)\]$/);
        if (match) { active = match[1]; result[active] ||= []; }
        else if (active && line.trim() && !line.trim().startsWith('#')) result[active].push(line.trim());
    }
    return result;
}
function scriptEntries(text, { includeCommented = false } = {}) {
    const entries = [];
    let active;
    for (const rawLine of text.split(/\r?\n/)) {
        const section = /^\[([^\]]+)\]$/.exec(rawLine.trim());
        if (section) { active = section[1]; continue; }
        if (active !== 'Script') continue;
        const match = /^\s*(#\s*)?([\w-]+)\s*=\s*(type=.*)$/.exec(rawLine);
        if (!match || (match[1] && !includeCommented)) continue;
        const parameters = match[3];
        const markers = [...parameters.matchAll(/(?:^|,)(type|pattern|requires-body|binary-body-mode|full-header-mode|max-size|engine|timeout|script-path|argument|cronexp|wake-system)=/g)];
        const entry = { name: match[2], commented: Boolean(match[1]) };
        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            entry[marker[1]] = parameters.slice(marker.index + marker[0].length, markers[i + 1]?.index ?? parameters.length);
        }
        entries.push(entry);
    }
    return entries;
}
module.exports = { publishRoot, fixtureRoot, remoteScriptPrefix, remoteModulePrefix, fixtureJSON, loadModuleFixture, sections, scriptEntries };
