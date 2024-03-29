const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const db = require('./db');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');

const router = express.Router();
const Filestore = require('session-file-store')(session);

router.use(cors({
  origin: 'http://localhost:3000', // 클라이언트의 주소
  credentials: true,
}));

router.use(
  session({
    store: new Filestore({
      path: 'sessions', // 세션 파일이 저장될 디렉토리
    }),
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
  })
);

ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
ffmpeg.setFfprobePath('/usr/bin/ffprobe');


// 클라이언트가 마이페이지에서 동영상을 올리면 url을 반환하는 엔드포인트
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/videos'); // 동영상을 저장할 폴더
  },

  filename: function (req, file, cb) {
    // // 파일명을 현재 시간 + 확장자로 설정
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

router.use(express.json());
router.use('/videos', express.static(path.join(__dirname, 'public/videos'))); // 정적 파일 서비스를 위해 public/videos 경로를 라우트합니다.

//video를 업로드하는 엔드포인트
router.post('/uploadVideo', upload.single('video'), async (req, res) => {
  try {
    console.log('post 요청 들어옴');
    
    console.log('req.body:', req.body);
    // if (!req.file) {
    //   return res.status(400).json({ error: 'No file uploaded' });
    // }
    // 여기에서 req.file를 사용하여 동영상 URL들을 생성
    const videoUrl = `http://172.10.7.58:80/contents/videos/${req.file.filename}`;
    // console.log('videoUrl');
    const selectedTag = req.body.selectedTag;
    const { title, artist } = req.body;

    // URL을 contents_table에 저장
    await db.execute('INSERT INTO madcamp_week4.contents_table (url, title, artist, genre, thumbnail) VALUES (?, ?, ?, ?, ?)', [videoUrl, title, artist, selectedTag, '']);
    console.log(videoUrl);

    // Thumbnail 생성 및 경로 저장
    const thumbnailFilename = `${Date.now()}_thumbnail.png`;
    const thumbnailPath = path.join(__dirname, 'public/thumbnails', thumbnailFilename);

    await generateThumbnail(`public/videos/${req.file.filename}`, thumbnailPath);

    const thumbnailUrl = `http://172.10.7.58:80/public/thumbnails/${thumbnailFilename}`;

    // 데이터베이스 업데이트
    await db.execute('UPDATE madcamp_week4.contents_table SET thumbnail = ? WHERE url = ?', [thumbnailUrl, videoUrl]);

    console.log(videoUrl);
    const [rows] = await db.execute('SELECT contents_id FROM madcamp_week4.contents_table WHERE url = ?', [videoUrl]);
    console.log(rows);
    const contentsId = rows[0]?.contents_id;

    console.log({ videoUrl, contentsId: contentsId });
    // 업로드 성공 시, 클라이언트에게 응답 데이터로 썸네일 경로 전송
    res.json({ videoUrl, contentsId: contentsId, thumbnailPath: thumbnailPath });
  } catch (error) {
    console.error('Error uploading videos:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Thumbnail 생성 함수
async function generateThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        folder: path.dirname(thumbnailPath),
        filename: path.basename(thumbnailPath),
        size: '400x240',
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        console.error('Error creating thumbnail:', err);
        reject(err);
      });
  });
}

// 유저가 저장한 컨텐츠 영상들의 썸네일들을 불러오는 엔드포인트
router.get('/getthumbnail', upload.none(), async (req, res) => {
  const email = req.query.email;
  try {
    console.log('get 요청 들어옴');
    console.log(email);
    // const loggedInUser = req.session.user; 
 
    // 사용자가 로그인했는지 확인
    // if (!loggedInUser) {
    //   // 사용자가 로그인되지 않은 경우
    //   res.status(401).json({ error: '로그인이 필요합니다.' });
    //   return;
    // }
    const [row, field] = await db.execute('SELECT * FROM madcamp_week4.user_table WHERE id = ?', [email]);
      console.log('users에서 데이터 가져감', row);
      if(row.length === 0) {
        console.log("해당 사용자를 찾을 수 없습니다");
        return res.status(404).json({error: '해당 사용자를 찾을 수 없습니다'});
      }

    // 유저가 저장한 컨텐츠의 썸네일 가져오기
    const query = `
      SELECT uc.user_contents_id, c.thumbnail
      FROM user_contents_table uc
      JOIN contents_table c ON uc.contents_id = c.contents_id
      WHERE uc.user_id = ?;
    `;

    const [rows] = await db.execute(query, [row[0].user_id]);
    console.log(rows);

    const thumbnails = rows.map((row) => ({
      user_contents_id: row.user_contents_id,
      thumbnail: row.thumbnail,
    }));

    res.json(thumbnails);
  } catch (error) {
    console.error('Error fetching thumbnails:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

module.exports = router;

// 장르별 컨텐츠 조회
router.get('/getgenrecontents', upload.none(), async (req, res) => {
    const genre = req.query.genre;
    try {
      console.log('get 요청 들어옴');
      const result = await db.execute('SELECT * FROM madcamp_week4.contents_table WHERE genre = ?', [genre]);
      const getContents = result[0];

      console.log(getContents);

      if (!getContents || getContents.length === 0) {
        // 컨텐츠가 없는 경우
        res.status(404).json({ error: '조회할 컨텐츠가 없음' });
        return;
      }
      
      res.json(getContents);
      console.log('조회 완료')

    } catch (error) {
      console.error('컨텐츠 조회 중 에러:', error);
      res.status(500).json({ error: '서버 오류' });
    }
  });  

//로그인한 사용자가 컨텐츠 저장
router.post('/postmycontents', upload.none(), async (req, res) => {
    const { email, contentsId } = req.body;
    try {
      console.log('post 요청 들어옴!!!!!!');
     
      // const loggedInUser = req.session.user;
      // const { contentsId } = req.body

      // if (!loggedInUser) {
      //   // 사용자가 로그인되지 않은 경우
      //   res.status(401).json({ error: '로그인이 필요합니다.' });
      //   return;
      // }
      const [rows, fields] = await db.execute('SELECT * FROM madcamp_week4.user_table WHERE id = ?', [email]);
      console.log('users에서 데이터 가져감', rows);
      if(rows.length === 0) {
        console.log("해당 사용자를 찾을 수 없습니다");
        return res.status(404).json({error: '해당 사용자를 찾을 수 없습니다'});
      }
      //const user = rows[0];

      await db.execute('INSERT INTO madcamp_week4.user_contents_table (user_id, contents_id) VALUES (?, ?)', [rows[0].user_id, contentsId]);

      console.log('컨텐츠 저장 완료');
    //   const selectResult = await db.execute('SELECT * FROM madcamp_week4.user_contents_table WHERE user_id = ? AND contents_id = ?', [loggedInUserId, contentsId]);
    //   console.log(selectResult);

      res.json({ message: '컨텐츠가 저장되었습니다.' });

    } catch (error) {
      console.error('컨텐츠 저장 중 에러:', error);
      res.status(500).json({ error: '서버 오류' });
    }
  });

//개인이 업로드한 컨텐츠 조회
router.get('/getmycontents', async (req, res) => {
 
    try {
      console.log('get 요청 들어옴');
      const loggedInUserId = req.session.user.user_id; 
      console.log(loggedInUserId);
      
      // 사용자가 로그인했는지 확인
      if (!loggedInUserId) {
        // 사용자가 로그인되지 않은 경우
        res.status(401).json({ error: '로그인이 필요합니다.' });
        return;
      }
      
      const result = await db.execute('SELECT * FROM madcamp_week4.user_contents_table WHERE user_id = ?', [loggedInUserId]);
      const userContents = result[0];

      console.log(userContents);

      if (!userContents || userContents.length === 0) {
        // 업로드한 컨텐츠가 없는 경우
        res.status(404).json({ error: '조회할 컨텐츠가 없음' });
        return;
      }
      
      res.json(userContents);
      console.log('조회 완료')

    } catch (error) {
      console.error('장르 선택 중 에러:', error);
      res.status(500).json({ error: '서버 오류' });
    }
  });

// 개인이 업로드한 컨텐츠 삭제
router.delete('/deletecontents', async (req, res) => {  
    const { contentsId } = req.body;

    try {
        // 사용자가 로그인했는지 확인
        const loggedInUserId = req.session.user.user_id; 
        console.log(loggedInUserId);
        
        // 사용자가 로그인했는지 확인
        if (!loggedInUserId) {
        // 사용자가 로그인되지 않은 경우
        res.status(401).json({ error: '로그인이 필요합니다.' });
        return;
        }

        const result = await db.execute('SELECT * FROM madcamp_week4.user_contents_table WHERE user_id = ? AND contents_id = ?', [loggedInUserId, contentsId]);
        const userContents = result[0];
        console.log(userContents);

        if (!userContents || userContents.length === 0) {
        // 컨텐츠 정보가 없는 경우 에러 처리 또는 적절한 로직 수행
        res.status(404).json({ error: '삭제할 정보를 찾을 수 없음' });
        return;
        } else {
        // 컨텐츠 정보를 찾으면 해당 컨텐츠 정보를 삭제
        await db.execute('DELETE FROM madcamp_week4.user_contents_table WHERE user_id = ? AND contents_id = ?', [loggedInUserId, contentsId]);
        res.json({ message: '컨텐츠가 삭제되었습니다.' });
        console.log('컨텐츠 삭제 완료!!!!');
        }
    } catch (error) {
        console.error('컨텐츠 삭제 중 에러:', error);
        res.status(500).json({ error: '서버 오류' });
    }
});

module.exports = router;