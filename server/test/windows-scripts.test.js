'use strict';

// The Windows .bat files cannot be run on the machines that run these tests, so the mistakes that are easy to make in a batch
// file are checked by reading them: line endings, labels that goto points at, quotes, the Node.js version test, and that
// `setup-shop.bat /check` can never change anything or wait for a key (the Windows CI job runs it for real).
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const batFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.bat')).sort();
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const commands = f => read(f).split('\r\n').filter(l => l.trim() && !/^\s*rem(\s|$)/i.test(l));

test('there are batch files to check', () => {
  assert.ok(batFiles.includes('setup-shop.bat') && batFiles.includes('start-server.bat'), batFiles.join(', '));
});

test('every batch file has Windows line endings, and git is told never to change them', () => {
  for (const f of batFiles) {
    const bytes = fs.readFileSync(path.join(ROOT, f));
    const bare = bytes.toString('latin1').replace(/\r\n/g, '').split('\n').length - 1;
    assert.equal(bare, 0, `${f} has ${bare} line(s) ending in a bare LF: cmd.exe can fail to find a goto label in such a file`);
    assert.ok(bytes.toString('latin1').endsWith('\r\n'), `${f} should end with a line break`);
  }
  const attributes = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\*\.bat\s+-text\s*$/m, '.gitattributes must keep *.bat as stored (CRLF)');
});

test('every goto and call points at a label that exists', () => {
  for (const f of batFiles) {
    const labels = new Set(read(f).split('\r\n').map(l => (l.match(/^:(\w+)/) || [])[1]).filter(Boolean).map(s => s.toLowerCase()));
    for (const line of commands(f)) {
      for (const m of line.matchAll(/\bgoto\s+:?(\w+)/gi)) {
        if (m[1].toLowerCase() === 'eof') continue;
        assert.ok(labels.has(m[1].toLowerCase()), `${f}: "${line.trim()}" jumps to :${m[1]}, which does not exist`);
      }
      for (const m of line.matchAll(/\bcall\s+:(\w+)/gi)) assert.ok(labels.has(m[1].toLowerCase()), `${f}: call to missing :${m[1]}`);
    }
  }
});

test('no command line has an odd number of double quotes (an unclosed quote swallows the rest of the line)', () => {
  for (const f of batFiles) {
    for (const line of commands(f)) {
      assert.equal((line.match(/"/g) || []).length % 2, 0, `${f}: ${line.trim()}`);
    }
  }
});

test('the Node.js version test in the scripts accepts 22.5 and newer and refuses older versions', () => {
  for (const f of ['start-server.bat', 'setup-shop.bat']) {
    const line = commands(f).find(l => /^node -e "/.test(l.trim()));
    assert.ok(line, `${f} has the version check`);
    const js = line.trim().match(/^node -e "(.*)"$/)[1];
    const exitCodeFor = version => {
      let code = null;
      new Function('process', js)({ versions: { node: version }, exit: c => { code = c; } });
      return code;
    };
    for (const [version, ok] of [['20.11.0', false], ['22.4.9', false], ['22.5.0', true], ['22.10.1', true], ['23.0.0', true], ['24.1.0', true], ['26.0.0', true]]) {
      assert.equal(exitCodeFor(version), ok ? 0 : 1, `${f}: Node ${version}`);
    }
  }
});

test('setup-shop.bat only uses scripts that exist, and each of them is still there to run by itself', () => {
  const used = new Set([...read('setup-shop.bat').replace(/%~dp0/g, '').matchAll(/[\w-]+\.bat/g)].map(m => m[0]).filter(f => f !== 'setup-shop.bat'));
  assert.ok(used.size >= 4, [...used].join(', '));
  for (const f of used) assert.ok(batFiles.includes(f), `setup-shop.bat mentions ${f}, which does not exist`);
  for (const f of ['allow-firewall.bat', 'install-autostart.bat', 'start-server.bat', 'open-counter.bat']) assert.ok(used.has(f), `${f} is part of the setup`);
});

test('setup-shop.bat /check changes nothing and never waits for a key', () => {
  const lines = commands('setup-shop.bat');
  const at = pattern => lines.findIndex(l => pattern.test(l));
  const nodeGuard = at(/\/check"\s+goto check_node_failed/i);
  const setupGuard = at(/\/check"\s+goto finish_check/i);
  assert.ok(nodeGuard > 0 && setupGuard > nodeGuard, 'both /check guards exist, in order');

  // Everything that installs, asks or waits comes after the guard that skips it in /check mode.
  for (const pattern of [/winget install/i, /^choice\b/i, /^pause\b/i]) assert.ok(at(pattern) > nodeGuard, `${pattern} must come after the Node.js guard`);
  for (const pattern of [/Start-Process/i, /call "%~dp0install-autostart\.bat"/i, /^start "Restaurant POS server"/i, /open-counter\.bat/i, /\bstart "" http/i]) {
    assert.ok(at(pattern) > setupGuard, `${pattern} must come after the setup guard`);
  }

  // The part that /check ends in asks and waits for nothing.
  const afterCheck = lines.slice(lines.findIndex(l => /^:finish_check/i.test(l)) + 1).join('\n');
  assert.doesNotMatch(afterCheck, /\bpause\b|\bchoice\b|\bwinget\b|schtasks \/create|netsh advfirewall firewall add/i);
  // ...and nothing before the guard can change the PC: the checks only read.
  const beforeGuard = lines.slice(0, setupGuard).join('\n');
  assert.doesNotMatch(beforeGuard.replace(/winget install[^\n]*/gi, ''), /schtasks \/create|netsh advfirewall firewall add|Start-Process|install-autostart|allow-firewall/i);
});
