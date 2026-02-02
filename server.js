const express = require('express');
const http = require('http');
const session = require('express-session');
const multer = require('multer');
const sharp = require("sharp");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require('path');
const fs = require("fs");

require("dotenv").config();
cloudinary.config({
 cloud_name: process.env.CLOUDINARY_NAME,
 api_key: process.env.CLOUDINARY_API_KEY,
 api_secret: process.env.CLOUDINARY_API_SECRET
});
const mongoose = require("mongoose");

// ================= MONGO CONNECT =================

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.log("❌ Mongo error:", err.message));

// ================= MODELS =================

// USER
const UserSchema = new mongoose.Schema({

 id:Number,

 username:String,
 password:String,

 name:String,
 email:String,
 photo:String,

 city:String,
 birthyear:String,

 uid:String, // firebase

 createdAt:String

});

const User = mongoose.model("User", UserSchema);


// ADS
const AdSchema = new mongoose.Schema({

 id:Number,

 title:String,
 price:String,
 phone:String,
 desc:String,
 category:String,
 city:String,

 photos:[String],

 userId:Number,

 booking:Boolean,

 time:Number,
 expireAt:Number,

 vip:Boolean,
 vipUntil:Number,

 likes:{
  type:Number,
  default:0
 },

 likedBy:[Number],

 views:{
  type:Number,
  default:0
 }

});

const Ad = mongoose.model("Ad", AdSchema);


// BOOKINGS
const BookingSchema = new mongoose.Schema({

 id:Number,

 renterId:Number,
 ownerId:Number,

 adId:Number,

 date:String,
 start:String,
 end:String,

 promo:String,

 status:String,

 created:Number,
 expireAt:Number,

 finished:Boolean

});

const Booking = mongoose.model("Booking", BookingSchema);


// MESSAGES
const MessageSchema = new mongoose.Schema({

 room:String,
 from:String,
 to:String,
 text:String,
 time:Number

});

const Message = mongoose.model("Message", MessageSchema);

const app = express();

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
  cookie:{
 maxAge:1000*60*60*24,
 sameSite:"lax"
}
}));

/* ===== FILE INIT ===== */

// folders
if (!fs.existsSync("temp")) fs.mkdirSync("temp");
if (!fs.existsSync("public/uploads"))
 fs.mkdirSync("public/uploads", { recursive: true });

console.log("✅ Upload folders ready");

/* ===== HELPERS ===== */

async function enrichBookings(bookings){

 const result = [];

 for(const b of bookings){

  const renter = await User.findOne({ id: b.renterId });
  const owner = await User.findOne({ id: b.ownerId });
  const ad = await Ad.findOne({ id: b.adId });

  result.push({

   ...b._doc,

   renterName: renter ? (renter.username || renter.name) : "Номаълум",
   ownerName: owner ? (owner.username || owner.name) : "Номаълум",
   adTitle: ad ? ad.title : "Эълон нест"

  });

 }

 return result;
}

// ===== USERS =====

function readUsers(){
 return USERS_CACHE;
}

function writeUsers(data){
 USERS_CACHE = data;
 saveAll();
}

// ===== ADS =====

async function readUsers(){
 return await User.find();
}

async function createUser(data){
 const user = new User(data);
 await user.save();
 return user;
}


/* ===== AUTH ===== */

function auth(req, res, next) {

 if(!req.session.user){

  // IF API REQUEST
  if(req.headers.accept?.includes("application/json")){
   return res.status(401).json({ logged:false });
  }

  // IF PAGE REQUEST
  return res.redirect("/login.html");
 }

 next();
}

/* ===== UPLOAD ===== */

const storage = new CloudinaryStorage({
 cloudinary: cloudinary,
 params: {
  folder: "pibozor",
  allowed_formats: ["jpg","jpeg","png","webp"],
  transformation: [
   { width: 1080, crop: "limit", quality: "auto" }
  ]
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

// ===== USER MODEL =====

app.post("/firebase-login", async (req,res)=>{

 const { uid, name, email, photo } = req.body;

 let user = await User.findOne({ uid });

 if(!user){

  user = await User.create({

   username: name,
   uid,
   email,
   photo

  });

  console.log("✅ New Google user saved in Mongo");
 }

 req.session.user = user;

 res.json({ success:true });

});

// PROFILE PAGE
app.get('/profile', auth, (req, res) => {
 res.sendFile(path.join(process.cwd(), 'public/profile.html'));
});


// ADD AD
app.post(
 "/add-ad",
 auth,
 upload.array("photos",5),
 compressImage,
 async (req,res)=>{

 try{

  let images = [];

  for(const file of req.files){

   const newPath = "public/uploads/" + file.filename;
   fs.renameSync(file.path,newPath);

   images.push("/uploads/" + file.filename);
  }

  const userId = req.session.user.id;

  // USER ADS COUNT
  const myAds = await Ad.find({ userId });

  const normalCount = myAds.filter(a => !a.booking).length;
  const bookingCount = myAds.filter(a => a.booking).length;

  if(req.body.booking === "true"){

   if(bookingCount >= 3){
    return res.json({
     success:false,
     message:"Максимум 3 эълони брон иҷозат аст"
    });
   }

  }else{

   if(normalCount >= 5){
    return res.json({
     success:false,
     message:"Максимум 5 эълони оддӣ иҷозат аст"
    });
   }

  }

  const days = Number(req.body.duration);
  const expireAt = Date.now() + days * 24 * 60 * 60 * 1000;

  // SAVE TO MONGO
  const ad = new Ad({

   title:req.body.title,
   price:req.body.price,
   phone:req.body.phone,
   desc:req.body.desc,
   category:req.body.category,
   city:req.body.city,

   photos:images,

   userId:userId,

   booking:req.body.booking === "true",

   time:Date.now(),
   expireAt,

   vip:false,
   vipUntil:null

  });

  await ad.save();

  res.redirect("/profile");

 }
 catch(err){

  console.log("ADD AD ERROR:", err.message);

  res.json({success:false});

 }

});

// DELETE AD
app.post('/delete-ad/:id', auth, async (req, res) => {

 try{

  const id = Number(req.params.id);

  if(isNaN(id)){
   return res.status(400).json({success:false});
  }

  const ad = await Ad.findOne({ time: id });

  if(!ad){
   return res.status(404).json({success:false});
  }

  // ONLY OWNER
  if(ad.userId !== req.session.user.id){
   return res.status(403).json({success:false});
  }

  // DELETE PHOTOS
  if(ad.photos){
   ad.photos.forEach(p=>{
    const f = "public" + p;
    if(fs.existsSync(f)) fs.unlinkSync(f);
   });
  }

  await Ad.deleteOne({ time: id });

  res.json({ success:true });

 }
 catch(err){

  console.log("DELETE ERROR:", err.message);

  res.json({success:false});
 }

});

app.get('/api/ads', async (req,res)=>{

 try{

  const ads = await Ad.find().sort({
   vip:-1,
   time:-1
  });

  res.json(ads);

 }
 catch(err){

  console.log("GET ADS ERROR:", err.message);

  res.json([]);

 }

});

app.get("/api/ad-owner/:id", async (req,res)=>{

 try{

  const ad = await Ad.findOne({ time: Number(req.params.id) });

  if(!ad){
   return res.json(null);
  }

  const owner = await User.findOne({ id: ad.userId });

  if(!owner){
   return res.json(null);
  }

  res.json({
   id: owner.id,
   username: owner.username || owner.name,
   city: owner.city || ""
  });

 }
 catch(err){

  console.log("OWNER ERROR:", err.message);

  res.json(null);

 }

});

// UPDATE AD (EDIT)

app.post('/edit-ad/:id', auth, upload.array('photos', 5), async (req, res) => {

 try{

  const id = Number(req.params.id);

  if(isNaN(id)){
   return res.json({ success:false });
  }

  const ad = await Ad.findOne({ time: id });

  if(!ad){
   return res.json({ success:false });
  }

  // ✅ ONLY OWNER
  if(ad.userId !== req.session.user.id){
   return res.json({ success:false });
  }

  // ✅ NEW IMAGES (if uploaded)
  let images = ad.photos;

  if(req.files && req.files.length){

   images = [];

   for(const file of req.files){

    const newPath = "public/uploads/" + file.filename;
    fs.renameSync(file.path, newPath);

    images.push("/uploads/" + file.filename);
   }

  }

  // ✅ UPDATE IN MONGO
  await Ad.updateOne(
   { time: id },
   {
    $set:{
     title: req.body.title,
     price: req.body.price,
     phone: req.body.phone,
     desc: req.body.desc,
     category: req.body.category,
     city: req.body.city,
     photos: images
    }
   }
  );

  res.json({ success:true });

 }
 catch(err){

  console.log("EDIT ERROR:", err.message);

  res.json({ success:false });

 }

});

// MY ADS (PROFILE)
app.get('/api/my-ads', auth, async (req, res) => {

 try{

  const uid = req.session.user.id;

  const myAds = await Ad.find({ userId: uid })
                        .sort({ time: -1 });

  res.json(myAds);

 }
 catch(err){

  console.log("MY ADS ERROR:", err.message);

  res.json([]);

 }

});

// GET SINGLE AD

 // 🔥 ADD VIEW

app.get('/api/ad/:id', async (req, res) => {

 try{

  const id = Number(req.params.id);

  const ad = await Ad.findOneAndUpdate(
   { id },
   { $inc: { views: 1 } },
   { new: true }
  );

  if(!ad){
   return res.status(404).json({ error: "Not found" });
  }

  res.json(ad);

 }
 catch(err){

  console.log("GET SINGLE AD ERROR:", err.message);

  res.status(500).json({ error: "Server error" });

 }

});

io.on("connection", socket => {

 console.log("✅ SOCKET CONNECTED:", socket.id);

 // ================= VISITOR CONNECT =================

 ONLINE_CONNECTIONS++;

 sendStats();

 // ================= REGISTER USER =================

 socket.on("registerUser", uid => {

  if(!uid) return;

  console.log("📥 REGISTER USER:", uid);

  socket.uid = uid;

  ONLINE_USERS.add(uid);

  sendStats();
 });

// ================= CHAT ROOM =================

socket.on("joinRoom", room => {

 if(!room) return;

 socket.join(room);

 console.log("📦 JOIN ROOM:", room);

});


// ================= SEND MESSAGE =================

socket.on("sendMessage", async data => {

 if(!data || !data.room || !data.text) return;

 const msg = {
  room: data.room,
  from: data.from || null,
  to: data.to || null,
  text: data.text,
  time: Date.now()
 };

 // SAVE TO MONGO
 await Message.create(msg);

 // SEND REALTIME
 io.to(data.room).emit("newMessage", msg);

 console.log("💬 MESSAGE SENT:", data.room);

});

// ================= DISCONNECT =================

socket.on("disconnect", () => {

 console.log("❌ SOCKET DISCONNECTED:", socket.id);

 // safe decrement
 ONLINE_CONNECTIONS = Math.max(ONLINE_CONNECTIONS - 1, 0);

 // remove user if exists
 if(socket.uid){
  ONLINE_USERS.delete(socket.uid);
 }

 sendStats();

});

 app.post("/firebase-login", async (req, res) => {

 try{

  const { uid, name, email, photo } = req.body;

  if(!uid){
   return res.json({ success:false });
  }

  // 🔍 FIND USER IN MONGO
  let user = await User.findOne({ uid });

  // 🆕 CREATE IF NOT EXISTS
  if(!user){

   user = await User.create({
    uid,
    username: name,
    name,
    email,
    photo,
    createdAt: new Date()
   });

   console.log("✅ New Google user created");
  }

  // 🔐 CREATE SESSION
  req.session.user = {
   id: user._id,
   uid: user.uid,
   username: user.username,
   name: user.name,
   photo: user.photo
  };

  res.json({ success:true });

 }
 catch(err){

  console.log("Firebase login error:", err.message);

  res.status(500).json({
   success:false
  });

 }

});

 // 5. CREATE SESSION
req.session.user = {
 id: user._id,
 uid: user.uid,
 username: user.username,
 name: user.name,
 photo: user.photo
};

// 6. RESPONSE
res.json({ success:true });

app.post("/api/update-profile", auth, async (req,res)=>{

 try{

  const { username, city, birthyear } = req.body;

  const updated = await User.findByIdAndUpdate(
   req.session.user.id,
   {
    username,
    city,
    birthyear
   },
   { new:true }
  );

  if(!updated){
   return res.json({ success:false });
  }

  // update session
  req.session.user.username = updated.username;

  res.json({ success:true });

 }catch(err){
  console.log("Update error:", err.message);
  res.json({ success:false });
 }

});

 app.post("/upload-avatar", auth, upload.single("avatar"), async (req,res)=>{

 if(!req.file){
  return res.redirect("/edit-profile.html");
 }

 try{

  const photoPath = "/uploads/" + req.file.filename;

  await User.findByIdAndUpdate(
   req.session.user.id,
   { photo: photoPath }
  );

  req.session.user.photo = photoPath;

  res.redirect("/profile");

 }catch(err){

  console.log("Avatar error:", err.message);
  res.redirect("/profile");

 }

});

//  MOVE FILE TO PUBLIC

app.post("/upload-avatar", auth, upload.single("avatar"), async (req,res)=>{

 if(!req.file){
  return res.redirect("/edit-profile.html");
 }

 // MOVE FILE TO PUBLIC
 const photoPath = "/uploads/" + req.file.filename;

 fs.renameSync(
  req.file.path,
  path.join("public", photoPath)
 );

 // UPDATE MONGO USER
 await User.findByIdAndUpdate(
  req.session.user._id,
  { photo: photoPath }
 );

 // UPDATE SESSION
 req.session.user.photo = photoPath;

 req.session.save(()=>{
  res.redirect("/profile");
 });

});

app.get("/api/normal-ads", async (req,res)=>{

 const ads = await Ad.find({ booking:false })
 .sort({ time:-1 });

 res.json(ads);
});

app.get("/api/booking-ads", async (req,res)=>{

 const ads = await Ad.find({ booking:true })
 .sort({ time:-1 });

 res.json(ads);
});

// GET BOOKINGS ONLY
app.get("/api/bookings", auth, async (req,res)=>{

 const bookings = await Booking.find();

 const enriched = await enrichBookingsMongo(bookings);

 res.json(enriched);

});

app.post("/api/request-booking", auth, async (req,res)=>{

 const { adId, date, start, end } = req.body;

 const ad = await Ad.findById(adId);

 if(!ad){
  return res.json({success:false,message:"Эълон ёфт нашуд"});
 }

 // ⛔ check busy time
 const reqStart = timeToMinutes(start);
 const reqEnd = timeToMinutes(end);

 const busy = await Booking.findOne({
  adId,
  date,
  status:"confirmed"
 });

 if(busy){
  const s = timeToMinutes(busy.start);
  const e = timeToMinutes(busy.end);

  if(reqStart < e && reqEnd > s){
   return res.json({
    success:false,
    message:"Ин вақт аллакай банд аст"
   });
  }
 }

 const promo = "PB-" + Math.random().toString(36).substring(2,8).toUpperCase();

 const expireAt = Date.now() + 30 * 60 * 1000;

 const booking = new Booking({

  renterId: req.session.user._id,
  ownerId: ad.userId,

  adId,
  date,
  start,
  end,

  promo,
  status:"pending",

  created: Date.now(),
  expireAt

 });

 await booking.save();

 res.json({
  success:true,
  promo,
  expireAt
 });

});
setInterval(async ()=>{

 const now = Date.now();

 // expire pending
 await Booking.updateMany(
  { status:"pending", expireAt:{ $lt: now } },
  { $set:{ status:"expired" } }
 );

 // finish confirmed
 const confirmed = await Booking.find({ status:"confirmed" });

 for(const b of confirmed){

  const endTime = new Date(b.date+" "+b.end).getTime();

  if(now > endTime){
   b.finished = true;
   await b.save();
  }

 }

},60000);
app.get("/api/my-booking-requests", auth, async (req,res)=>{

 const uid = req.session.user._id;

 const bookings = await Booking.find({
  status:"pending",
  $or:[
   { ownerId: uid },
   { renterId: uid }
  ]
 });

 const result = await enrichBookingsMongo(bookings);

 res.json(result);

});
app.get("/api/my-active-bookings", auth, async (req,res)=>{

 const uid = req.session.user._id;

 const bookings = await Booking.find({
  status:"confirmed",
  finished: { $ne:true },
  $or:[
   { ownerId: uid },
   { renterId: uid }
  ]
 });

 const result = await enrichBookingsMongo(bookings);

 res.json(result);

});
app.post("/api/confirm-booking", auth, async (req,res)=>{

 const promo = req.body.promo?.trim().toUpperCase();

 if(!promo){
  return res.json({success:false,message:"Код ворид нашуд"});
 }

 const booking = await Booking.findOne({ promo });

 if(!booking){
  return res.json({success:false,message:"Код нодуруст"});
 }

 if(booking.ownerId != req.session.user._id){
  return res.json({success:false,message:"⛔ Access denied"});
 }

 if(booking.status !== "pending"){
  return res.json({success:false,message:"Already used"});
 }

 booking.status = "confirmed";
 booking.confirmedAt = Date.now();

 await booking.save();

 res.json({success:true});

});

app.get("/api/my-booking-history", auth, async (req,res)=>{

 const uid = req.session.user._id;

 const bookings = await Booking.find({
  $or:[
   { ownerId: uid },
   { renterId: uid }
  ],
  $or:[
   { status:"expired" },
   { status:"rejected" },
   { finished:true }
  ]
 });

 const result = await enrichBookingsMongo(bookings);

 res.json(result);

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
 l
});

app.post("/api/like", auth, async (req,res)=>{

 const uid = req.session.user._id;
 const { adId } = req.body;

 const ad = await Ad.findById(adId);

 if(!ad){
  return res.json({ success:false });
 }

 if(!ad.likedBy){
  ad.likedBy = [];
 }

 const pos = ad.likedBy.indexOf(uid.toString());

 // ✅ UNLIKE
 if(pos !== -1){

  ad.likedBy.splice(pos,1);
  ad.likes = ad.likedBy.length;

  await ad.save();

  return res.json({
   success:true,
   liked:false,
   likes: ad.likes
  });
 }

 // ✅ LIKE
 ad.likedBy.push(uid);
 ad.likes = ad.likedBy.length;

 await ad.save();

 res.json({
  success:true,
  liked:true,
  likes: ad.likes
 });

});
 res.json({success:true});

});


app.get("/api/user/:id", async (req,res)=>{
 try{

  const uid = req.params.id;

  const user = await User.findById(uid).lean();

  if(!user){
   return res.json(null);
  }

  const userAds = await Ad.find({ userId: uid })
                          .sort({ time:-1 })
                          .lean();

  res.json({
   id: user._id,
   username: user.username || user.name,
   city: user.city || "",
   photo: user.photo || "/avatar.png",
   createdAt: user.createdAt,
   adsCount: userAds.length,
   ads: userAds
  });

 }
 catch(err){
  console.log("User API error:", err.message);
  res.json(null);
 }

});

// ================= AUTO PING (ANTI SLEEP) =================

const https = require("https");

const SELF_URL = "https://alon-qxlw.onrender.com";

setInterval(() => {
  https.get(SELF_URL, (res) => {
    console.log("Auto ping:", res.statusCode);
  }).on("error", (err) => {
    console.log("Ping error:", err.message);
  });
}, 5 * 60 * 1000); // every 5 minutes

setInterval(async () => {

 try{

  const now = Date.now();

  const expired = await Ad.find({
   expireAt: { $lte: now }
  });

  if(!expired.length) return;

  // DELETE PHOTOS
  for(const ad of expired){

   if(ad.photos){

    ad.photos.forEach(p => {

     const filePath = "public" + p;

     if(fs.existsSync(filePath)){
      fs.unlinkSync(filePath);
     }

    });

   }

  }

  // DELETE FROM DB
  const result = await Ad.deleteMany({
   expireAt: { $lte: now }
  });

  console.log("🧹 Expired ads removed:", result.deletedCount);

 }
 catch(err){
  console.log("Expire error:", err.message);
 }

}, 60000);

app.get("/api/me", async (req,res)=>{

 if(!req.session.user){
  return res.json({ logged:false });
 }

 try{

  const user = await User.findById(req.session.user._id)
                         .select("-password")
                         .lean();

  if(!user){
   return res.json({ logged:false });
  }

  res.json({
   logged:true,
   user
  });

 }
 catch(err){
  console.log("ME error:", err.message);
  res.json({ logged:false });
 }

});

app.post("/api/vip/create", auth, async (req,res)=>{

 try{

  const { adId, plan } = req.body;

  const ad = await Ad.findOne({ id: Number(adId) });

  if(!ad){
   return res.json({
    success:false,
    message:"Эълон ёфт нашуд"
   });
  }

  // ONLY OWNER
  if(ad.userId !== req.session.user.id){
   return res.json({
    success:false,
    message:"Иҷозат нест"
   });
  }

  let days = 0;
  let price = 0;

  if(plan === "1"){
   days = 3;
   price = 10;
  }
  else if(plan === "2"){
   days = 10;
   price = 30;
  }
  else if(plan === "3"){
   days = 30;
   price = 60;
  }
  else{
   return res.json({
    success:false,
    message:"Пакет нодуруст"
   });
  }

  // ⚠️ payment redirect (test mode)
  res.json({
   success:true,
   payUrl: `/vip-success.html?id=${adId}&days=${days}&price=${price}`
  });

 }
 catch(err){

  console.log("VIP create error:", err.message);

  res.json({
   success:false,
   message:"Server error"
  });

 }

});

app.post("/api/vip/confirm", auth, async (req,res)=>{

 try{

  const { adId, days } = req.body;

  const ad = await Ad.findOne({ id: Number(adId) });

  if(!ad){
   return res.json({ success:false });
  }

  // ONLY OWNER
  if(ad.userId !== req.session.user.id){
   return res.json({ success:false });
  }

  ad.vip = true;
  ad.vipUntil = Date.now() + (Number(days) * 24 * 60 * 60 * 1000);

  await ad.save();

  res.json({ success:true });

 }
 catch(err){

  console.log("VIP confirm error:", err.message);

  res.json({
   success:false,
   message:"Server error"
  });

 }

});

app.get("/api/messages/:room", auth, async (req,res)=>{

 try{

  const room = req.params.room;

  const list = await Message
   .find({ room })
   .sort({ time: 1 });

  res.json(list);

 }
 catch(err){

  console.log("Get messages error:", err.message);

  res.json([]);

 }

});

/* ===== START SERVER ===== */

server.listen(PORT, () => {
 console.log(`Server running on http://localhost:${PORT}`);
});
