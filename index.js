const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require('body-parser');
const cors = require('cors');
const puppeteer = require('puppeteer');
const {
  likelist,
  user_record,
  artist_sublist,
  user_account
} = require('NeteaseCloudMusicApi');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// Supabase 初始化
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eiyaloehytwaralfqsrk.supabase.co',
  process.env.SUPABASE_KEY ||
    'YOUR_PUBLIC_KEY'
);

// Puppeteer 全局存储登录实例
let loginBrowser;
let loginPage;

// 访问 /login 打开官方网易云登录页面
app.get('/login', async (req, res) => {
  try {
    loginBrowser = await puppeteer.launch({
      headless: false, // 可视化，用户扫码或输入密码
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    loginPage = await loginBrowser.newPage();
    await loginPage.goto('https://music.163.com/login', { waitUntil: 'networkidle2' });

    // 提示前端页面
    res.send(`
      <h2>请在弹出的网易云音乐窗口完成登录，然后点击下面按钮提交 MUSIC_U</h2>
      <button onclick="fetch('/fetch-cookie').then(res => res.json()).then(d => alert('MUSIC_U 已提交'))">提交 MUSIC_U</button>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('打开登录页面失败');
  }
});

// 获取 MUSIC_U 并导入数据
app.get('/fetch-cookie', async (req, res) => {
  try {
    if (!loginPage) return res.status(400).send({ error: '登录页面未初始化' });

    // 获取 cookie
    const cookies = await loginPage.cookies();
    const musicUCookie = cookies.find(c => c.name === 'MUSIC_U');
    if (!musicUCookie) throw new Error('未获取到 MUSIC_U');
    const cookieValue = `MUSIC_U=${musicUCookie.value};`;

    // 使用 NeteaseCloudMusicApi 获取用户信息
    const accountRes = await user_account({ cookie: cookieValue });
    const profile = accountRes.body.profile;
    const userId = profile.userId;

    // 喜欢的歌曲
    const likeRes = await likelist({ cookie: cookieValue, uid: userId });
    const likedSongs = likeRes.body.ids || [];
    if (likedSongs.length) {
      const rows = likedSongs.map(id => ({
        netease_user_id: userId,
        track_id: id
      }));
      await supabase.from('user_likes').insert(rows);
    }

    // 播放记录
    const recordRes = await user_record({ cookie: cookieValue, uid: userId, type: 1 });
    const records = recordRes.body.allData || [];
    if (records.length) {
      const rows = records.map(r => ({
        netease_user_id: userId,
        track_id: r.song.id,
        played_at: new Date(r.playTime)
      }));
      await supabase.from('user_history').insert(rows);
    }

    // 关注的歌手
    const artistsRes = await artist_sublist({ cookie: cookieValue, limit: 100, offset: 0 });
    const artists = artistsRes.body.data || [];
    if (artists.length) {
      const rows = artists.map(a => ({
        netease_user_id: userId,
        artist_id: a.id
      }));
      await supabase.from('user_artists').insert(rows);
    }

    // 插入账户信息
    await supabase.from('netease_accounts').insert({
      netease_user_id: userId,
      netease_username: profile.nickname,
      cookie: cookieValue
    });

    // 关闭浏览器
    await loginBrowser.close();
    loginBrowser = null;
    loginPage = null;

    res.json({ message: '导入完成', musicU: musicUCookie.value });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
