const express = require('express');
const http = require('http');
const session = require('express-session');
const multer = require('multer');
const sharp = require("sharp");
const path = require('path');
const fs = require("fs");
let BOOKINGS_CACHE = [];
let USERS_CACHE = [];
let ADS_CACHE = [];
let onlineUsers = 0;
let bookingLock = false;
const app = express();
const compression = require("compression");
app.use(compression());

app.use(express.static(path.join(__dirname, 'public')));
app.use("/uploads",
 express.static("public/uploads",{
  maxAge:"30d"
 })
);

const server = http.createServer(app);

const { Server } = require('socket.io');
const io = new Server(server);
const PORT = 3000;

/* ===== MIDDLEWARE ===== */

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'pibozor_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use('/uploads', express.static('uploads'));

/* ===== FILE INIT ===== */

if (!fs.existsSync("temp")) fs.mkdirSync("temp");
if (!fs.existsSync("public/uploads")) fs.mkdirSync("public/uploads",{recursive:true});
if (!fs.existsSync('users.json')) fs.writeFileSync('users.json', '[]');
if (!fs.existsSync('ads.json')) fs.writeFileSync('ads.json', '[]');
if (!fs.existsSync('bookings.json')) {
 fs.writeFileSync('bookings.json','[]');
}

BOOKINGS_CACHE = JSON.parse(fs.readFileSync("bookings.json"));
USERS_CACHE = JSON.parse(fs.readFileSync("users.json"));
ADS_CACHE = JSON.parse(fs.readFileSync("ads.json"));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

/* ===== HELPERS ===== */

function enrichBookings(bookings){

 const users = readUsers();
 const ads = readAds();

 return bookings.map(b => {

  const renter = users.find(u => u.id === b.renterId);
  const owner = users.find(u => u.id === b.ownerId);
  const ad = ads.find(a => a.id == b.adId);

  return {
   ...b,

   renterName: renter ? (renter.username || renter.name) : "Номаълум",
   ownerName: owner ? (owner.username || owner.name) : "Номаълум",
   adTitle: ad ? ad.title : "Эълон нест"
  };

 });

}

const readUsers = () => {
  try {
    return JSON.parse(fs.readFileSync('users.json','utf8'));
  } catch {
    return [];
  }
};
const writeUsers = d => {
  fs.writeFileSync('users.json', JSON.stringify(d, null, 2), 'utf8');
};

const readAds = () => {
  try {
    return JSON.parse(fs.readFileSync('ads.json','utf8'));
  } catch {
    return [];
  }
};
const writeAds = d => {
  fs.writeFileSync('ads.json', JSON.stringify(d, null, 2), 'utf8');
};

/* ===== AUTH ===== */

function auth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

/* ===== UPLOAD ===== */

const storage = multer.diskStorage({
 destination:(req,file,cb)=>{
  cb(null,"temp");
 },
 filename:(req,file,cb)=>{
  cb(null, Date.now() + ".jpg");
 }
});

const upload = multer({
 storage,
 limits:{
  fileSize: 20 * 1024 * 1024
 }
});


async function compressImage(req, res, next) {

 if (!req.files) return next();

 for (const file of req.files) {

  let input = file.path;
  let output = file.path;

  let quality = 80;
  let size = 999999;

  // Resize first (mobile optimal)
  let image = sharp(input).resize({
   width: 1080,
   withoutEnlargement: true
  });

  // LOOP UNTIL < 80KB
  while (size > 80 * 1024 && quality >= 40) {

   await image
    .jpeg({
     quality: quality,
     mozjpeg: true
    })
    .toFile(output + "_tmp.jpg");

   size = fs.statSync(output + "_tmp.jpg").size;

   quality -= 10;
  }

  // Replace original
  fs.renameSync(output + "_tmp.jpg", output);

 }

 next();
}

function timeToMinutes(t){
 const [h,m] = t.split(":").map(Number);
 return h*60 + m;
}

/* ===== ROUTES ===== */

// SIGNUP
app.post("/signup", (req, res) => {

 const { username, password, firstname, lastname, birthyear, city } = req.body;

 if(!username || !password){
  return res.json({
   success:false,
   message:"Ҳамаи майдонҳоро пур кун"
  });
 }

 let users = readUsers();

 const exists = users.find(u => u.username === username);

 if (exists) {
  return res.json({
   success:false,
   message:"Бо ин ном аллакай корбар ҳаст ❌"
  });
 }

 const newUser = {
  id: Date.now(),
  username: username.trim(),
  password: password.trim(),
  firstname,
  lastname,
  birthyear,
  city
 };

 users.push(newUser);
 writeUsers(users);
 USERS_CACHE = users;

 return res.json({
  success:true
 });

});

// LOGIN
app.post('/login', (req, res) => {

  const username = req.body.username.trim();
  const password = req.body.password.trim();

  const users = readUsers();

  const user = users.find(u =>
    u.username === username && u.password === password
  );

  if (!user) {
    return res.send('Wrong login');
  }

  req.session.user = user;
  res.redirect('/profile');

});


// PROFILE PAGE
app.get('/profile', auth, (req, res) => {
 res.sendFile(path.join(process.cwd(), 'public/profile.html'));
});


// PROFILE DATA API
app.get("/api/me", (req,res)=>{

 if(!req.session.user){
  return res.json(null);
 }

 const users = readUsers();

 const me = users.find(u=>u.id === req.session.user.id);

 res.json({
 ...me,
 username: me.username || me.name
});

});

// LOGOUT
app.get('/logout', (req, res) => {

  req.session.destroy(() => {
    res.redirect('/');
  });

});


// ADD AD
app.post(
 "/add-ad",
 auth,
 upload.array("photos",5),
 compressImage,
 (req,res)=>{

 let images = [];

 for(const file of req.files){

   const newPath = "public/uploads/" + file.filename;

  fs.renameSync(file.path,newPath);

  images.push("/uploads/" + file.filename);
 }

 const ads = readAds();

 ads.push({
  id: Date.now(),
  title: req.body.title,
  price: req.body.price,
  phone: req.body.phone,
  desc: req.body.desc,
  category: req.body.category,
  city: req.body.city,
  photos: images,
  userId: req.session.user.id,
  booking: req.body.booking === "true",
  time: Date.now()
 });

 writeAds(ads);
 ADS_CACHE = ads;

 res.redirect("/profile");
});

// DELETE AD
app.post('/delete-ad/:id', auth, (req, res) => {

  const id = Number(req.params.id);

  let ads = readAds();

  const index = ads.findIndex(ad => ad.id === id);

  if(index === -1){
    return res.send('Эълон ёфт нашуд');
  }

  // фақат эълони соҳиби худаш
  if(ads[index].userId !== req.session.user.id){
    return res.send('Иҷозат надорӣ');
  }

  // танҳо 1 дона удалит
  ads.splice(index, 1);

  writeAds(ads);

  res.redirect('/profile');

});

app.get('/api/ads', (req, res) => {
  const ads = readAds();
  ads.sort((a,b)=>{

 if(b.vip && !a.vip) return 1;
 if(a.vip && !b.vip) return -1;

 return (b.time||0) - (a.time||0);

});

res.json(ads);
});

app.get("/api/ad-owner/:id",(req,res)=>{

 const ads = readAds();
 const users = readUsers();

 const ad = ads.find(a => a.id == req.params.id);

 if(!ad){
  return res.json(null);
 }

 const owner = users.find(u => u.id === ad.userId);

 if(!owner){
  return res.json(null);
 }

 res.json({
  id: owner.id,
  username: owner.username || owner.name,
  city: owner.city
 });

});

// UPDATE AD (EDIT)

app.post('/edit-ad/:id', auth, upload.array('photos', 5), (req, res) => {

 const id = Number(req.params.id);

 let ads = readAds();

 const index = ads.findIndex(ad => ad.id === id);

 if(index === -1){
  return res.json({ success:false });
 }

 // only owner
 if(ads[index].userId !== req.session.user.id){
  return res.json({ success:false });
 }

 const images = req.files && req.files.length
 ? req.files.map(f => '/uploads/' + f.filename)
 : ads[index].photos;

 ads[index] = {
  ...ads[index],
  title: req.body.title,
  price: req.body.price,
  phone: req.body.phone,
  desc: req.body.desc,
  category: req.body.category,
  city: req.body.city,
  photos: images
 };

 writeAds(ads);

 res.json({ success:true });

});

// MY ADS (PROFILE)
app.get('/api/my-ads', (req, res) => {

  if(!req.session.user){
    return res.json([]);
  }

  const ads = readAds();

  const myAds = ads.filter(ad =>
    ad.userId === req.session.user.id
  );

  res.json(myAds);
});

// GET SINGLE AD

 // 🔥 ADD VIEW

app.get('/api/ad/:id', (req, res) => {

 const ads = readAds();

 const index = ads.findIndex(a => a.id == req.params.id);

 if(index === -1){
  return res.status(404).json({ error: 'Not found' });
 }

 // ❌ no auto increment here
 res.json(ads[index]);

});

io.on('connection', (socket) => {

 onlineUsers++;

 const users = JSON.parse(fs.readFileSync("users.json"));
 const totalUsers = users.length;

 io.emit("stats", {
  online: onlineUsers,
  total: totalUsers
 });

 socket.on('disconnect', () => {

  onlineUsers--;

  const users = JSON.parse(fs.readFileSync("users.json"));

  io.emit("stats", {
   online: onlineUsers,
   total: users.length
  });

 });

});

app.post("/firebase-login",(req,res)=>{

 // 1. DATA FROM FIREBASE
 const { uid, name, email, photo } = req.body;

 // 2. READ USERS.JSON
 let users = readUsers();

 // 3. SEARCH USER
 let user = users.find(u => u.uid === uid);

 // 4. IF NEW USER → CREATE
 if(!user){

  user = {
 id: Date.now(),
 uid,
 username: name,   // ⭐ муҳим
 name,
 email,
 photo,
 createdAt: new Date().toISOString()
};

  users.push(user);

  writeUsers(users);

  console.log("New Google user created");
 }

 // 5. CREATE SESSION
 req.session.user = user;

 // 6. RESPONSE TO BROWSER
 res.json({ success:true });

});

app.post("/api/update-profile", auth, (req,res)=>{

 let users = readUsers();

 const index = users.findIndex(u=>u.id === req.session.user.id);

 if(index === -1){
  return res.json({success:false});
 }

 users[index].username = req.body.username;
 users[index].city = req.body.city;
 users[index].birthyear = req.body.birthyear;

 writeUsers(users);

 req.session.user = users[index];

req.session.save(() => {
 res.json({ success:true });
});

});

app.post("/upload-avatar", auth, upload.single("avatar"), (req,res)=>{

 let users = readUsers();

 const index = users.findIndex(u=>u.id === req.session.user.id);

 if(index === -1) return res.redirect("/profile");

 users[index].photo = "/uploads/" + req.file.filename;

 writeUsers(users);

 req.session.user = users[index];

 res.redirect("/profile");

});

app.get("/api/normal-ads",(req,res)=>{
 const ads = readAds();
 const normal = ads.filter(a => !a.booking);
 res.json(normal);
});

app.get("/api/booking-ads",(req,res)=>{
 const ads = readAds();
 const bookingAds = ads.filter(a => a.booking === true);
 res.json(bookingAds);
});

// GET BOOKINGS ONLY
app.get("/api/bookings", auth, (req,res)=>{
 res.json(enrichBookings(BOOKINGS_CACHE));
});

app.post("/api/request-booking",(req,res)=>{

 if(!req.session.user){
  return res.json({
   success:false,
   message:"Аввал ба аккаунт ворид шавед"
  });
 }

 const { adId, date, start, end } = req.body;

 const ads = readAds();
 const ad = ads.find(a=>a.id==adId);

 if(!ad){
  return res.json({success:false,message:"Эълон ёфт нашуд"});
 }

 let list = BOOKINGS_CACHE;

 // check busy time
  const reqStart = timeToMinutes(start);
const reqEnd = timeToMinutes(end);

const busy = list.find(b => {

 if(
  b.adId != adId ||
  b.date != date ||
  b.status !== "confirmed"
 ) return false;

 const s = timeToMinutes(b.start);
 const e = timeToMinutes(b.end);

 return reqStart < e && reqEnd > s;

});

 if(busy){
  return res.json({
   success:false,
   message:"Ин вақт аллакай банд аст"
  });
 }

 const promo = "PB-" + Math.random().toString(36).substring(2,8).toUpperCase();

 const expireAt = Date.now() + 30 * 60 * 1000;

 const booking = {
  id: Date.now(),

  renterId: req.session.user.id,
  ownerId: ad.userId,

  adId,
  date,
  start,
  end,

  promo,
  status: "pending",

  created: Date.now(),
  expireAt
};

 list.push(booking);

 fs.writeFileSync("bookings.json",JSON.stringify(list,null,2));
 BOOKINGS_CACHE = list;

 // ✅ IMPORTANT RESPONSE
 res.json({
  success:true,
  promo,
  expireAt
 });

});

function minutesToTime(min){
 let h = Math.floor(min/60);
 let m = min%60;
 return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
}

setInterval(()=>{

 let list = BOOKINGS_CACHE;
 const now = Date.now();

 list = list.map(b=>{

  // auto expire
  if(
   b.status==="pending" &&
   b.expireAt &&
   now > b.expireAt
  ){
   b.status="expired";
   b.state="expired";
  }

  // auto finish confirmed
  if(b.status==="confirmed"){
   const endTime = new Date(b.date+" "+b.end).getTime();
   if(now > endTime){
    b.finished = true;
   }
  }

  return b;
 });

 fs.writeFileSync("bookings.json",JSON.stringify(list,null,2));
 BOOKINGS_CACHE = list;

},60000);

app.get("/api/my-booking-requests", auth, (req,res)=>{

 const uid = req.session.user.id;

 const bookings = BOOKINGS_CACHE;

 const result = bookings.filter(b =>
  b.status === "pending" &&
  (b.ownerId === uid || b.renterId === uid)
 );

 res.json(enrichBookings(result));

});

app.get("/api/my-active-bookings", auth, (req,res)=>{

 const uid = req.session.user.id;
 const bookings = BOOKINGS_CACHE;

 const result = bookings.filter(b =>
  b.status === "confirmed" &&
  !b.finished &&
  (b.ownerId === uid || b.renterId === uid)
 );

 res.json(enrichBookings(result));

});

app.get("/booking-action", auth, (req,res)=>{

 const { id, action } = req.query;

 let list = BOOKINGS_CACHE;

 const booking = list.find(b=>b.id == id);

 if(!booking){
  return res.send("Booking not found");
 }

 if(booking.ownerId !== req.session.user.id){
 return res.send("Access denied");
}

 if(action === "accept"){

 const reqStart = timeToMinutes(booking.start);
 const reqEnd = timeToMinutes(booking.end);

 const conflict = list.find(b => {

 if(
  b.id === booking.id ||
  b.adId != booking.adId ||
  b.date != booking.date ||
  b.status !== "confirmed"
 ) return false;

 const s = timeToMinutes(b.start);
 const e = timeToMinutes(b.end);

 return reqStart < e && reqEnd > s;

});

if(conflict){
 return res.send("❌ Ин вақт аллакай банд аст");
}

 booking.status = "confirmed";
}

 if(action === "reject"){
  booking.status = "rejected";
  booking.rejectedAt = Date.now();
 }

 fs.writeFileSync("bookings.json",JSON.stringify(list,null,2));
 BOOKINGS_CACHE = list;

 res.send(`
  <h2>✅ Амалиёт анҷом ёфт</h2>
  <p>Шартнома ${action==="accept"?"қабул":"рад"} карда шуд</p>
 `);

});

app.post("/api/check-promo", (req,res)=>{

 const { promo: code } = req.body;

 let bookings = BOOKINGS_CACHE;
 let users = readUsers();

 const b = bookings.find(x => x.promo === code);

 if(!b){
  return res.json({success:false,message:"Промокод ёфт нашуд"});
 }

 // FIND REAL USER
 const u = users.find(x => x.id === b.renterId);

 res.json({
  success:true,
  booking:{
   id: b.id,
   user: u ? (u.username || u.name) : "User",
   date: b.date,
   start: b.start,
   end: b.end
  }
 });

});

app.post("/api/confirm-booking",(req,res)=>{
 if(bookingLock){
  return res.json({
   success:false,
   message:"⏳ Лутфан интизор шавед..."
  });
 }

 bookingLock = true;

 let promo = req.body.promo?.trim().toUpperCase();

 if(!promo){
  return res.json({success:false,message:"Код ворид нашуд"});
 }

 if(!req.session.user){
  return res.json({success:false,message:"Login required"});
 }

 let list = BOOKINGS_CACHE;

 const booking = list.find(b => b.promo === promo);

 if(!booking){
  return res.json({success:false,message:"Код нодуруст"});
 }

 if(booking.ownerId !== req.session.user.id){
  return res.json({
   success:false,
   message:"⛔ Ин брон ба шумо тааллуқ надорад"
  });
 }

 if(booking.status !== "pending"){
  return res.json({
   success:false,
   message:"Ин код фаъол нест"
  });
 }

// CHECK CONFLICT AGAIN
 const reqStart = timeToMinutes(booking.start);
const reqEnd = timeToMinutes(booking.end);

const conflict = list.find(b => {

 if(
  b.id === booking.id ||
  b.adId != booking.adId ||
  b.date != booking.date ||
  b.status !== "confirmed"
 ) return false;

 const s = timeToMinutes(b.start);
 const e = timeToMinutes(b.end);

 return reqStart < e && reqEnd > s;

});

if(conflict){

 bookingLock = false;

 return res.json({
  success:false,
  message:"❌ Ин вақт аллакай тасдиқ шудааст"
 });

}

 booking.status = "confirmed";
 booking.state = "active";
 booking.confirmedAt = Date.now();

 fs.writeFileSync("bookings.json", JSON.stringify(list,null,2));
 BOOKINGS_CACHE = list;
 bookingLock = false;

 res.json({success:true});

});

app.get("/api/my-booking-history", auth, (req,res)=>{

 const uid = req.session.user.id;
 const list = BOOKINGS_CACHE;

 const result = list.filter(b =>
  (b.ownerId === uid || b.renterId === uid) &&
  (
   b.status === "rejected" ||
   b.status === "expired" ||
   b.finished === true
  )
 );

 res.json(enrichBookings(result));

});

app.post("/api/like",(req,res)=>{

 if(!req.session.user){
  return res.json({success:false,message:"Login required"});
 }

 const uid = req.session.user.id;
 const { adId } = req.body;

 let ads = readAds();
 const index = ads.findIndex(a => a.id == adId);

 if(index === -1){
  return res.json({success:false});
 }

 if(!ads[index].likedBy){
  ads[index].likedBy = [];
 }

 const pos = ads[index].likedBy.indexOf(uid);

 // ✅ UNLIKE
 if(pos !== -1){

  ads[index].likedBy.splice(pos,1);
  ads[index].likes = ads[index].likedBy.length;

  writeAds(ads);

  return res.json({
   success:true,
   liked:false,
   likes: ads[index].likes
  });
 }

 // ✅ LIKE
 ads[index].likedBy.push(uid);
 ads[index].likes = ads[index].likedBy.length;

 writeAds(ads);

 res.json({
  success:true,
  liked:true,
  likes: ads[index].likes
 });

});

app.post("/api/add-view",(req,res)=>{

 const { adId } = req.body;

 let ads = readAds();

 const index = ads.findIndex(a=>a.id==adId);

 if(index === -1){
  return res.json({success:false});
 }

 ads[index].views = (ads[index].views || 0) + 1;

 writeAds(ads);

 res.json({success:true});

});

app.get("/api/user/:id",(req,res)=>{

 const uid = Number(req.params.id);

 const users = readUsers();
 const ads = readAds();

 const user = users.find(u=>u.id === uid);

 if(!user){
  return res.json(null);
 }

 const userAds = ads.filter(a=>a.userId === uid);

 res.json({
  id: user.id,
  username: user.username || user.name,
  city: user.city || "",
  photo: user.photo || "/avatar.png",
  createdAt: user.createdAt || user.id,
  adsCount: userAds.length,
  ads: userAds
 });

});

app.post("/api/make-vip", auth, (req,res)=>{

 const { adId } = req.body;

 let ads = readAds();

 const index = ads.findIndex(a=>a.id==adId);

 if(index === -1){
  return res.json({success:false,message:"Эълон ёфт нашуд"});
 }

 // танҳо соҳиби эълон
 if(ads[index].userId !== req.session.user.id){
  return res.json({success:false,message:"Иҷозат нест"});
 }

 // VIP flag
 ads[index].vip = true;
 ads[index].vipTime = Date.now();

 writeAds(ads);

 res.json({success:true});

});

/* ===== START SERVER ===== */

server.listen(PORT, () => {
 console.log(`Server running on http://localhost:${PORT}`);
});

