import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const index = read('index.html');
const app = read('assets/app.js');
const style = read('assets/style.css');

assert.equal(index.includes('environment.js'), false, '首页仍加载温湿度脚本');
assert.equal(index.includes('温湿度月度记录'), false, '首页仍包含温湿度页面文案');
assert.equal(index.includes('温湿度生成值'), false, '首页仍包含温湿度免责声明');
assert.equal(app.includes('EnvironmentRecorder'), false, '应用仍注册温湿度模块');
assert.equal(/\.environment-sheet|\.env-/.test(style), false, '样式表仍包含温湿度样式');
assert.equal(fs.existsSync(new URL('assets/environment.js', root)), false, '温湿度脚本文件仍存在');
assert.equal(fs.existsSync(new URL('tests/test_environment.mjs', root)), false, '温湿度旧测试仍存在');

console.log('PASS: 温湿度记录页面、脚本、样式和旧测试均已移除');
