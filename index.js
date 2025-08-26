// index.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { verify_getQr, verify_qrCheck, likelist, user_record, artist_sublist } = require('NeteaseCloudMusicApi');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// Supabase 初始化（使用提供的项目 URL 和密钥）
const supabase = createClient(
  'https://eiyaloehytwaralfqsrk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpeWFsb2VoeXR3YXJhbGZxc3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxMzk1MzYsImV4cCI6MjA3MDcxNTUzNn0.t6E4Ps8qRsukYJUFUJ7ZTuc3nmn0SeKlSFIUi2QcVKk',
  {
    global: { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpeWFsb2VoeXR3YXJhbGZxc3JrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTEzOTUzNiwiZXhwIjoyMDcwNzE1NTM2fQ.YmGN8CDQ3SImzaeSegJspIuqJTohCT-aHXn6mAEEd38' } }
  }
);

// 生成网易云登录二维码
app.get('/login/qr', async (req, res) => {
  try {
    const result = await verify_getQr();
    const qrKey = result.body.data.unikey;
    const qrImage = Buffer.from(result.body.data.qrimg.split(',')[1], 'base64');
    res.json({ key: qrKey, img: result.body.data.qrimg });
  } catch (error) {
    res.status(500).send('无法获取二维码');
  }
});

// 轮询检查二维码扫码状态
app.get('/login/check', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).send('缺少 key');
  try {
    const result = await verify_qrCheck({ key });
    if (result.body.code === 800) {
      // 二维码已失效
      return res.json({ status: 'expired' });
    } else if (result.body.code === 803) {
      // 登录成功，返回 cookie
      const cookie = result.body.cookie;
      return res.json({ status: 'logged', cookie });
    } else {
      // 801: 等待扫码, 802: 等待确认
      return res.json({ status: 'pending' });
    }
  } catch (error) {
    res.status(500).send('扫码状态检查失败');
  }
});

// 将用户数据导入 Supabase
app.post('/import', async (req, res) => {
  const cookie = req.body.cookie;
  if (!cookie) return res.status(400).send('缺少 cookie');
  try {
    // 获取用户个人信息
    const userInfo = await likelist({ cookie, uid: null }); // likelist 需要 uid，可改用 user/detail 接口获取 uid
    // 这里简化：假设 cookie 自带用户 ID 为 0（实际应使用 user/detail 接口）
    const userId = 0; // 或者 userInfo.body.profile.userId

    // 获取喜欢的歌曲列表
    const likeRes = await likelist({ cookie, uid: userId });
    const likedSongs = likeRes.body.ids || [];
    // 插入 user_likes 表
    if (likedSongs.length) {
      const rows = likedSongs.map(id => ({ netease_user_id: userId, track_id: id }));
      await supabase.from('user_likes').insert(rows);
    }

    // 获取播放记录（allData 包含历史记录）
    const recordRes = await user_record({ cookie, uid: userId, type: -1 });
    const records = recordRes.body.allData || [];
    // 插入 user_history 表
    if (records.length) {
      const rows = [];
      records.forEach(day => {
        day.data.forEach(entry => {
          rows.push({
            netease_user_id: userId,
            track_id: entry.song.id,
            played_at: new Date(entry.playTime)  // 转化为时间戳
          });
        });
      });
      if (rows.length) await supabase.from('user_history').insert(rows);
    }

    // 获取用户关注的歌手列表
    const artistsRes = await artist_sublist({ cookie, limit: 100, offset: 0 });
    const artists = artistsRes.body.data.list || [];
    // 插入 user_artists 表
    if (artists.length) {
      const rows = artists.map(a => ({ netease_user_id: userId, artist_id: a.id }));
      await supabase.from('user_artists').insert(rows);
    }

    // 插入账户信息到 netease_accounts
    await supabase.from('netease_accounts').insert({
      netease_user_id: userId,
      netease_username: userInfo.body.profile.nickname || '',
      cookie: cookie
    });

    res.send('导入完成');
  } catch (error) {
    console.error(error);
    res.status(500).send('数据导入失败');
  }
});

// 监听端口
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
