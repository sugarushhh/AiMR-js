// index.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  login_qr_key,
  login_qr_create,
  login_qr_check,
  likelist,
  user_record,
  artist_sublist,
  user_account
} = require('NeteaseCloudMusicApi');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// Supabase 初始化
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eiyaloehytwaralfqsrk.supabase.co',
  process.env.SUPABASE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpeWFsb2VoeXR3YXJhbGZxc3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxMzk1MzYsImV4cCI6MjA3MDcxNTUzNn0.t6E4Ps8qRsukYJUFUJ7ZTuc3nmn0SeKlSFIUi2QcVKk'
);

// 获取二维码
app.get('/login/qr', async (req, res) => {
  try {
    const keyRes = await login_qr_key({});
    const key = keyRes.body.data.unikey;

    const qrRes = await login_qr_create({ key, qrimg: 1 });
    res.json({ key, img: qrRes.body.data.qrimg });
  } catch (error) {
    console.error(error);
    res.status(500).send('无法获取二维码');
  }
});

// 检查扫码状态
app.get('/login/check', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).send('缺少 key');
  try {
    const result = await login_qr_check({ key });
    if (result.body.code === 800) {
      return res.json({ status: 'expired' });
    } else if (result.body.code === 803) {
      const cookie = result.body.cookie;
      return res.json({ status: 'logged', cookie });
    } else {
      return res.json({ status: 'pending' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('扫码状态检查失败');
  }
});

// 导入用户数据
app.post('/import', async (req, res) => {
  const cookie = req.body.cookie;
  if (!cookie) return res.status(400).send('缺少 cookie');

  try {
    // 获取用户账户信息
    const accountRes = await user_account({ cookie });
    const profile = accountRes.body.profile;
    const userId = profile.userId;

    // 喜欢的歌曲
    const likeRes = await likelist({ cookie, uid: userId });
    const likedSongs = likeRes.body.ids || [];
    if (likedSongs.length) {
      const rows = likedSongs.map(id => ({
        netease_user_id: userId,
        track_id: id
      }));
      await supabase.from('user_likes').insert(rows);
    }

    // 播放记录
    const recordRes = await user_record({ cookie, uid: userId, type: 1 });
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
    const artistsRes = await artist_sublist({ cookie, limit: 100, offset: 0 });
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
      cookie
    });

    res.send('导入完成');
  } catch (error) {
    console.error('导入失败:', error);
    res.status(500).send('数据导入失败');
  }
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
