// 把微信开发者工具的"当前项目/最近项目"指向 WeLibAppt
// 必须在 IDE 完全退出后运行，否则会被 IDE 覆盖
const fs = require('fs');
const path = require('path');

const DIR = 'D:\\微信开发者工具\\User Data\\197e2437452d20fc392ff75353ba2967\\WeappLocalData';
const NEW_PATH = 'D:\\Desktop\\wh\\ds\\WeLibAppt';
const NEW_NAME = 'WeLibAppt';

function readJson(name, def) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) {
    console.log('  (不存在，用默认值) ' + name);
    return def;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log('  (解析失败，用默认值) ' + name + ' :: ' + e.message);
    return def;
  }
}

function backup(name) {
  const p = path.join(DIR, name);
  if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
}

function write(name, content) {
  backup(name);
  fs.writeFileSync(path.join(DIR, name), content, 'utf8');
  console.log('  已写入 ' + name);
}

console.log('目标项目: ' + NEW_PATH);

// 1) last_select —— IDE 启动时打开这个项目
write('localstorage_7b5967917ffd9baf64fe6c2781fd9f76.json', JSON.stringify({ projectid: NEW_PATH }));

// 2) last_all_projects —— 最近项目列表，把新项目放最前，保留原有
const all = readJson('localstorage_04ae2c5abd947dac11469f3c23a393b5.json', []);
const list = Array.isArray(all) ? all.filter((x) => x && x.projectid !== NEW_PATH) : [];
list.unshift({ projectid: NEW_PATH, plainTextEditProject: false });
write('localstorage_04ae2c5abd947dac11469f3c23a393b5.json', JSON.stringify(list));

// 3) reduxPersist:projectList —— 项目元信息字典，追加新项目并保留原有
const projList = readJson('localstorage_914f1d8fd4ec79bf7a0946881c319ec2.json', {});
projList[NEW_PATH] = {
  projectId: NEW_PATH,
  appId: 'touristappid',
  projectPath: NEW_PATH,
  projectName: NEW_NAME,
  compileType: 'weapp',
  appImageUrl: '',
  isGame: false,
  appName: '博物馆门票预约小程序',
  appType: 0,
  cloudProject: false,
};
write('localstorage_914f1d8fd4ec79bf7a0946881c319ec2.json', JSON.stringify(projList));

// 4) access_time —— 记录访问时间
const at = readJson('localstorage_a96b4f6adcbf14bf13c794bd3da45da6.json', {});
at[NEW_PATH] = Date.now();
write('localstorage_a96b4f6adcbf14bf13c794bd3da45da6.json', JSON.stringify(at));

// 5) last_compiled —— 上次编译的项目（纯字符串，非 JSON）
write('localstorage_8c3226c79557feedb37591541eb52924.json', 'project2_' + NEW_PATH);

console.log('\n完成。原有项目条目均已保留，可用 IDE 的"最近项目"切回。');
