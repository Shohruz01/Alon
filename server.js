require("dotenv").config();

const express = require("express");
const http = require("http");
const session = require("express-session");
const multer = require("multer");
const Jimp = require("jimp");
const path = require("path");
const fs = require("fs");
const compression = require("compression");
const minifyHTML = require("express-minify-html-terser");
const mongoose = require("mongoose");

// ================= MONGO =================

mongoose.connect(
 process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pibozor"
)
.then(()=>console.log("✅ Mongo connected"))
.catch(err=>console.log("❌ Mongo error:",err));

// ================= SCHEMA =================

const UserSchema = new mongoose.Schema({

 username:String, // system id
 name:String,     // DISPLAY NAME ✅

 email:String,
 photo:String,

 city:String,
 birthyear:String,

 createdAt:{type:Date,default:Date.now},

 lastSeen:{
 type:Number,
 default: Date.now
}

});

const AdSchema = new mongoose.Schema({

 title:String,
 price:Number,
 phone:String,
 whatsapp:String,
 desc:String,

 category:String,
 sub:String,
 city:String,

 photos:[String],

 userId:String,

 booking:Boolean,

 time:Number,
 expireAt:Number,

 vip:{type:Boolean,default:false},
 vipUntil:Number,

 likes:{type:Number,default:0},
 likedBy:[String],

 views:{type:Number,default:0},
 viewedBy:[String]

});

const BookingSchema = new mongoose.Schema({

 adId:{
  type: mongoose.Schema.Types.ObjectId,
  ref: "Ad",
  required: true,
  index: true
 },

 renterId:{
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true,
  index: true
 },

 ownerId:{
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true,
  index: true
 },

 date:{
  type: String,
  required: true
 },

 start:{
  type: String,
  required: true
 },

 end:{
  type: String,
  required: true
 },

 promo:{
  type: String,
  index: true
 },

 status:{
  type: String,
  enum:["pending","confirmed","rejected","expired"],
  default:"pending",
  index:true
 },

 created:{
  type: Number,
  default: Date.now
 },

 expireAt:{
  type: Number,
  index:true
 },

 historyExpireAt:{
 type:Date,
 index:{ expireAfterSeconds:0 }
}

});

const MessageSchema = new mongoose.Schema({

 room:String,

 from:String,
 to:String,

 text:String,

 time:{
  type:Number
 },

 read:{ type:Boolean, default:false }

});


// ✅ AUTO DELETE AFTER 10 DAYS
MessageSchema.index(
 { time: 1 },
 { expireAfterSeconds: 60 * 60 * 24 * 10 }
);

const User = mongoose.model("User",UserSchema);
const Ad = mongoose.model("Ad",AdSchema);
const Booking = mongoose.model("Booking",BookingSchema);
const Message = mongoose.model("Message",MessageSchema);

// ================= APP =================

const app = express();
app.use(express.static(path.join(__dirname,"public")));

app.use("/uploads", express.static(path.join(__dirname,"public/uploads")));
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

const PORT = 3000;

// ================= MIDDLEWARE =================

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({extended:true}));

// ✅ SESSION
app.use(session({
 secret:"pibozor_secret",
 resave:false,
 saveUninitialized:false,
 cookie:{
  maxAge:1000*60*60*24,
  sameSite:"lax"
 }
}));

// ================= AUTH =================

function auth(req, res, next) {

 if (!req.session.user) {

  const wantsJSON =
    req.headers.accept?.includes("application/json") ||
    req.headers["content-type"]?.includes("application/json") ||
    req.xhr ||
    req.path.startsWith("/api");

  if (wantsJSON) {
    return res.status(401).json({ logged: false });
  }

  return res.redirect("/login.html");
 }

 next();
}

app.post("/firebase-login", async (req, res) => {

 const { email, displayName, photoURL } = req.body;

 if (!email) {
  return res.json({ success:false });
 }

 let user = await User.findOne({ email });

 if (!user) {

  user = await User.create({

   username: email.split("@")[0], // SYSTEM
   name: displayName || "",       // DISPLAY NAME
   email: email,
   photo: photoURL || "",
   city: "",
   birthyear: ""

  });

 } else {

  // ✅ UPDATE GOOGLE NAME IF CHANGED
  await User.updateOne(
   { _id: user._id },
   {
    name: displayName || user.name,
    photo: photoURL || user.photo
   }
  );

 }

 const updated = await User.findOne({ email });

 req.session.user = updated;

 res.json({ success:true });

});

app.post("/api/update-profile", auth, async (req, res) => {

 try{

  const { name, city, birthyear } = req.body;

  const updated = await User.findByIdAndUpdate(
   req.session.user._id,
   {
    name,
    city,
    birthyear
   },
   { new:true }
  );

  req.session.user = updated;

  res.json({ success:true });

 }catch(e){

  console.log("PROFILE UPDATE ERROR:", e);
  res.status(500).json({ success:false });

 }

});

// ================= IMAGE UPLOAD =================

if(!fs.existsSync("public/uploads")){
 fs.mkdirSync("public/uploads",{recursive:true});
}

const storage = multer.diskStorage({
 destination:(req,file,cb)=>{
  cb(null,"public/uploads");
 },
 filename:(req,file,cb)=>{
  cb(null, Date.now()+"-"+file.originalname);
 }
});

const upload = multer({
 storage,
 limits:{ fileSize: 20 * 1024 * 1024 }
});

async function compressImage(req, res, next) {

 if (!req.files || req.files.length === 0) return next();

 try {

  for (const file of req.files) {

   let img = await Jimp.read(file.path);

   // 📏 resize барои нигоҳ доштани сифат
   if (img.getWidth() > 720) {
    img.resize(720, Jimp.AUTO);
   }

   // 📦 ҳам PNG ҳам JPG → JPG мегардонем
   let newPath = file.path.replace(/\.(png|jpeg|jpg)$/i, ".jpg");

   let quality = 60;

   while(true){

    await img
     .quality(quality)
     .writeAsync(newPath);

    const sizeKB = fs.statSync(newPath).size / 1024;

    // 🎯 target 60KB
    if(sizeKB <= 60 || quality <= 40){
     break;
    }

    quality -= 5;
   }

   // ❌ delete original
   if(file.path !== newPath){
    fs.unlinkSync(file.path);
   }

   // update multer
   file.filename = path.basename(newPath);
   file.path = newPath;

  }

  next();

 } catch (err) {

  console.log("COMPRESS ERROR:", err);
  next();

 }
}

// ================= AVATAR UPLOAD =================

app.post("/upload-avatar",
 auth,
 upload.single("avatar"),
 async (req,res)=>{

  try{

   if(!req.file){
    return res.status(400).json({ success:false });
   }

   const filePath = req.file.path;

   const img = await Jimp.read(filePath);

   // ===== CROP CENTER SQUARE =====

   const size = Math.min(
    img.getWidth(),
    img.getHeight()
   );

   const x = (img.getWidth()  - size) / 2;
   const y = (img.getHeight() - size) / 2;

   img.crop(x, y, size, size);

   // ===== RESIZE TO AVATAR SIZE =====

   img.resize(300, 300);

   // ===== COMPRESS =====

   await img
    .quality(65)      // 60–70 ideal
    .writeAsync(filePath);

   const imgPath = "/uploads/" + req.file.filename;

   // SAVE IN DB

   await User.updateOne(
    { _id: req.session.user._id },
    { photo: imgPath }
   );

   // REFRESH SESSION

   const updated = await User.findById(req.session.user._id);
   req.session.user = updated;

   res.json({ success:true });

  }catch(e){

   console.log("AVATAR JIMP ERROR:", e);
   res.status(500).json({ success:false });

  }

});

// ================= AUTH ROUTES =================

app.post("/signup",async(req,res)=>{

 const {username,password,firstname,lastname,birthyear,city}=req.body;

 const exists = await User.findOne({username});
 if(exists) return res.json({success:false});

 await User.create({
  username,password,firstname,lastname,birthyear,city
 });

 sendStats();

 res.json({success:true});

});

app.post("/login",async(req,res)=>{

 const user = await User.findOne({
  username:req.body.username,
  password:req.body.password
 });

 if(!user) return res.json({success:false});

 req.session.user=user;

 res.json({success:true});

});

app.get("/logout",(req,res)=>{
 req.session.destroy(()=>res.redirect("/"));
});

app.get("/profile",auth,(req,res)=>{
 res.sendFile(path.join(process.cwd(),"public/home.html"));
});

// ================= ADS =================

app.post("/add-ad",
 auth,
 upload.array("photos",5),
 compressImage,
 async(req,res)=>{

 try{

  // ⛔ LIMITS
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;

  const isBooking = String(req.body.booking) === "true";

  // 📦 лимити эълони одӣ
  if(!isBooking){

   const adsCount = await Ad.countDocuments({
    userId: String(req.session.user._id),
    booking:false,
    time: { $gt: now - threeDays }
   });

   if(adsCount >= 3){
    return res.json({
     success:false,
     message:"Шумо танҳо 3 эълон дар 3 рӯз гузошта метавонед"
    });
   }

  }

  // 📅 лимити эълони брон
  if(isBooking){

   const bookingAdsCount = await Ad.countDocuments({
    userId: String(req.session.user._id),
    booking:true,
    time: { $gt: now - threeDays }
   });

   if(bookingAdsCount >= 2){
    return res.json({
     success:false,
     message:"Шумо танҳо 2 эълони брон дар 3 рӯз гузошта метавонед"
    });
   }

  }

  // 🖼 ИН ҶО МУҲИМ — суратҳоро мегирем
  const images = req.files?.map(f=>"/uploads/"+f.filename) || [];

  // 1️⃣ CREATE AD
  await Ad.create({

   title:req.body.title,
   price:Number(req.body.price) || 0,
   phone:req.body.phone,
   whatsapp:req.body.whatsapp,
   desc:req.body.desc,

   category:req.body.category,
   sub:req.body.sub,
   city:req.body.city,

   photos: images,   // 👈 ҳоло дуруст

   userId:String(req.session.user._id),

   booking:isBooking,

   time:Date.now(),
   expireAt:Date.now()+Number(req.body.duration||7)*86400000

  });

  res.json({ success:true });

 }catch(e){

  console.log("ADD AD ERROR:", e);

  res.json({
   success:false,
   message:"Хато дар сервер"
  });

 }

});

app.get("/api/ads", async(req,res)=>{

 const ads = await Ad.find({
  booking:false
 }).sort({ time:-1 });

 res.json(ads);

});

app.get("/api/ad/:id", async (req, res) => {

 try{

  const id = req.params.id;

  if(!mongoose.Types.ObjectId.isValid(id)){
   return res.status(400).json({ error:"Invalid ID" });
  }

  const ad = await Ad.findById(id).lean();

  if(!ad){
   return res.status(404).json({ error:"Not found" });
  }

  // ✅ booking already inside ad
  res.json(ad);

 }catch(err){

  console.log("GET AD ERROR:", err);
  res.status(500).json({ error:"Server error" });

 }

});

app.post("/delete-ad/:id", auth, async (req, res) => {

 try{

  const id = req.params.id;

  if(!mongoose.Types.ObjectId.isValid(id)){
   return res.json({ success:false });
  }

  const ad = await Ad.findById(id);

  if(!ad) return res.json({ success:false });

  if(String(ad.userId) !== String(req.session.user._id)){
   return res.json({ success:false });
  }

  // 🗑 УДАЛИТ СУРАТҲО АЗ ДИСК
  if(ad.photos && ad.photos.length){

   for(const img of ad.photos){

    const filePath = path.join(__dirname, "public", img);

    if(fs.existsSync(filePath)){
     fs.unlinkSync(filePath);
     console.log("🗑 Image deleted:", filePath);
    }

   }

  }

  // 🗑 УДАЛИТ АЗ БАЗА
  await Ad.deleteOne({ _id:id });

  // 🗑 УДАЛИТ БРОНҲОИ МАРБУТ
  await Booking.deleteMany({ adId: id });

  res.json({ success:true });

 }catch(e){

  console.log("DELETE ERROR:", e);
  res.json({ success:false });

 }

});

// ================= LIKE =================

app.post("/api/like",auth,async(req,res)=>{

 const uid = String(req.session.user._id);
 const ad = await Ad.findById(req.body.adId);

 if(!ad) return res.json({success:false});

 const pos = ad.likedBy.indexOf(uid);

 if(pos !== -1){
  ad.likedBy.splice(pos,1);
 }else{
  ad.likedBy.push(uid);
 }

 ad.likes = ad.likedBy.length;

 await ad.save();

 res.json({
 success:true,
 liked: pos === -1,
 likes: ad.likes
});

});

// ================= VIEW =================

app.post("/api/add-view", async (req,res)=>{

 try{

  const ip =
   req.headers["x-forwarded-for"] ||
   req.socket.remoteAddress;

  const ad = await Ad.findById(req.body.adId);

  if(!ad) return res.json({success:false});

  // ❌ Already viewed
  if(ad.viewedBy.includes(ip)){
   return res.json({success:true, counted:false});
  }

  // ✅ New view
  ad.viewedBy.push(ip);
  ad.views++;

  await ad.save();

  res.json({success:true, counted:true});

 }catch(e){

  console.log("VIEW ERROR:",e);
  res.json({success:false});

 }

});

// ================= BOOKINGS =================

app.get("/api/bookings", async (req,res)=>{

 try{

  const list = await Ad.find({
   booking: true
  }).sort({ time:-1 });


  res.json(list);

 }catch(e){

  console.log("BOOKING API ERROR:", e);
  res.json([]);

 }

});

app.get("/api/my-booking-requests", auth, async (req,res)=>{

 const uid = String(req.session.user._id);

 const list = await Booking.find({
  ownerId: uid,
  status: "pending"
 })
 .populate("renterId","name")
 .populate("adId","title")
 .sort({ created:-1 });

 res.json(list);

});

app.get("/api/my-sent-bookings", auth, async (req,res)=>{

 const uid = String(req.session.user._id);

 const list = await Booking.find({
  renterId: uid
 })
 .populate("ownerId","name")
 .populate("adId","title")
 .sort({ created:-1 });

 res.json(list);

});

app.get("/api/my-active-bookings", auth, async (req,res)=>{

 const uid = String(req.session.user._id);

 const list = await Booking.find({
  $or:[
   { renterId: uid },
   { ownerId: uid }
  ],
  status:"confirmed"
 })
 .populate("renterId","name")
 .populate("adId","title")
 .lean();

 const now = new Date();

 // 🧠 танҳо бронҳои оянда
 const active = list.filter(b=>{
  const endTime = new Date(b.date + " " + b.end);
  return endTime > now;
 });

 // 🧠 SORT BY DATE + TIME
 active.sort((a,b)=>{
  const aTime = new Date(a.date + " " + a.start);
  const bTime = new Date(b.date + " " + b.start);
  return aTime - bTime;
 });

 res.json(active);

});

app.get("/api/my-booking-history", auth, async (req,res)=>{

 const uid = String(req.session.user._id);

 const list = await Booking.find({
  $or:[
   { renterId: uid },
   { ownerId: uid }
  ],
  status:{ $in:["rejected","expired"] }
 })
 .populate("renterId","name")
 .populate("adId","title")
 .sort({ created:-1 });

 res.json(list);

});

app.get("/booking-action", auth, async (req,res)=>{

 const { id, action } = req.query;

 const book = await Booking.findById(id);
 if(!book) return res.json({success:false});

 if(String(book.ownerId) !== String(req.session.user._id)){
  return res.json({success:false});
 }

 if(action==="accept"){
  book.status="confirmed";
  book.confirmedAt=Date.now();
 }

 if(action==="reject"){
  book.status="rejected";
  book.rejectedAt=Date.now();
 }

 await book.save();

 res.json({success:true});

});

setInterval(async()=>{

 const now = Date.now();

 await Booking.updateMany(
  {
   status:"pending",
   expireAt:{ $lt: now }
  },
  {
   status:"expired"
  }
 );

}, 60000);

app.post("/api/request-booking", auth, async (req,res)=>{

 try{


  const uid = req.session.user._id;

  const { adId, date, start, end } = req.body;

  if(!adId || !date || !start || !end){
   return res.json({ success:false, message:"Missing fields" });
  }

  const ad = await Ad.findById(adId);

  if(!ad || !ad.booking){
   return res.json({ success:false, message:"Booking disabled" });
  }

  // ⛔ CHECK TIME OVERLAP (REAL CONFLICT)
   const conflict = await Booking.findOne({
 adId: ad._id,
 date: date,
 status:"confirmed",   // ⬅ фақат тасдиқшуда вақтро мебандад
 $or:[
  {
   start: { $lt: end },
   end:   { $gt: start }
  }
 ]
});

  if(conflict){
   return res.json({
    success:false,
    message:"Ин вақт аллакай банд аст"
   });
  }

  // 🎟 PROMO CODE
  const promo =
   Math.random().toString(36).substring(2,8).toUpperCase();

  const expire = Date.now() + 15 * 60 * 1000;

  await Booking.create({

   adId: ad._id,
   renterId: uid,
   ownerId: ad.userId,

   date,
   start,
   end,

   promo,
   expireAt: expire

  });

  res.json({
   success:true,
   promo,
   expireAt: expire
  });

 }catch(e){

  console.log("BOOKING CREATE ERROR:", e);
  res.json({ success:false });

 }

});

app.post("/api/confirm-booking", auth, async (req,res)=>{

 try{

  const uid = String(req.session.user._id);
  const { code, action } = req.body;

  const booking = await Booking.findOne({ promo: code });

  if(!booking){
   return res.json({ success:false });
  }

  if(booking.status !== "pending"){
   return res.json({ success:false });
  }

  // owner only
  if(String(booking.ownerId) !== uid){
   return res.json({ success:false });
  }

  // ⏱ агар муҳлат гузашта бошад → expired + history countdown
  if(booking.expireAt < Date.now()){
   booking.status = "expired";
   booking.historyExpireAt =
     new Date(Date.now() + 7*24*60*60*1000);
   await booking.save();
   return res.json({ success:false });
  }

  /* ================= CONFIRM ================= */

  if(action === "ok"){

   // 🔒 check overlap
   const already = await Booking.findOne({
    adId: booking.adId,
    date: booking.date,
    status: "confirmed",
    $or:[
     { start: { $lt: booking.end }, end: { $gt: booking.start } }
    ]
   });

   if(already){
    return res.json({
     success:false,
     message:"Ин вақт аллакай ба дигар кас дода шудааст"
    });
   }

   // ✅ confirm ҳамин брон
   booking.status = "confirmed";
   booking.confirmedAt = Date.now();
   await booking.save();

   // ❌ дигар pending-ҳоро reject кун + history delete timer
   await Booking.updateMany({
    adId: booking.adId,
    date: booking.date,
    status:"pending",
    _id:{ $ne: booking._id },
    $or:[
     { start: { $lt: booking.end }, end: { $gt: booking.start } }
    ]
   },{
    status:"rejected",
    historyExpireAt:
      new Date(Date.now() + 7*24*60*60*1000)
   });

   return res.json({
    success:true,
    bookingId: booking._id
   });
  }

  /* ================= REJECT ================= */

  if(action === "no"){
   booking.status = "rejected";

   // ⏱ history auto delete after 7 days
   booking.historyExpireAt =
     new Date(Date.now() + 7*24*60*60*1000);
  }

  await booking.save();

  res.json({
   success:true,
   bookingId: booking._id
  });

 }catch(e){

  console.log("CONFIRM ERROR:",e);
  res.json({ success:false });

 }

});

app.get("/api/booking-by-code/:code", auth, async (req,res)=>{

 try{

   const booking = await Booking.findOne({
 promo:req.params.code
})
  .populate("adId","title")
  .populate("renterId","name");

  if(!booking) return res.json({success:false});

  res.json({
   success:true,
   ad: booking.adId.title,
   renter: booking.renterId.name,
   date: booking.date,
   start: booking.start,
   end: booking.end
  });

 }catch(e){
  res.json({success:false});
 }

});

// ================= CHAT =================

app.get("/api/messages/:room", auth, async (req,res)=>{

 const myId = String(req.session.user._id);

 const room = req.params.room;

 const list = await Message.find({ room });

 // MARK READ
 await Message.updateMany(
  { room, to: myId, read:false },
  { read:true }
 );

 res.json(list);

});


app.get("/api/my-chats", auth, async (req,res)=>{

 try{

  const myId = String(req.session.user._id);

  const messages = await Message.aggregate([

   {
    $match:{
     $or:[
      { from: myId },
      { to: myId }
     ]
    }
   },

   { $sort:{ time:-1 } },

   {
    $group:{
     _id:"$room",

     lastMessage:{ $first:"$text" },

     time:{ $first:"$time" },

     users:{ $addToSet:"$from" },

     unread:{
      $sum:{
       $cond:[
        {
         $and:[
          { $eq:["$to", myId] },
          { $eq:["$read", false] }
         ]
        },
        1,
        0
       ]
      }
     }

    }
   }

  ]);

  const result = [];

  for(const c of messages){

   // add receiver user
   const fullUsers = [...c.users];

   // find missing user
   const msg = await Message.findOne({ room:c._id });

   if(msg){
    if(!fullUsers.includes(msg.to)) fullUsers.push(msg.to);
    if(!fullUsers.includes(msg.from)) fullUsers.push(msg.from);
   }

   const otherId = fullUsers.find(u => u !== myId);

   const user = await User.findById(otherId);

   result.push({
    room:c._id,
    users:fullUsers,
    lastMessage:c.lastMessage,
    unread:c.unread,
    otherName: user?.name || "User",
    online: ONLINE_USERS.has(otherId)
   });

  }

  res.json(result);

 }catch(e){

  console.log("MY CHATS ERROR:",e);
  res.json([]);

 }

});

// ================= SOCKET =================

 io.on("connection", socket => {

 socket.on("joinRoom", room=>{
  socket.join(room);
 });

 socket.on("sendMessage", async data => {

  const msg = await Message.create({
   room:data.room,
   from:data.from,
   to:data.to,
   text:data.text,
   time:Date.now()
  });

  io.to(data.room).emit("newMessage", msg);

 });

});

// ================= API ME =================

app.get("/api/me",(req,res)=>{

 if(req.session.user){
  res.json({logged:true,user:req.session.user});
 }else{
  res.json({logged:false});
 }

});

app.get("/api/my-ads", auth, async (req, res) => {

 const ads = await Ad.find({
  userId: String(req.session.user._id)
 }).sort({ time: -1 });

 res.json(ads);

});

app.get("/", (req,res)=>{
 res.sendFile(path.join(__dirname,"public/index.html"));
});

app.get("/api/user/:id", async (req,res)=>{

 try{

  const id = req.params.id;

  if(!mongoose.Types.ObjectId.isValid(id)){
   return res.json({success:false});
  }

  const user = await User.findById(id).lean();
  if(!user) return res.json({success:false});

  const ads = await Ad.find({ userId:String(id) })
   .sort({ time:-1 })
   .lean();

  res.json({
   success:true,
   user:{
   name:user.name,
   city:user.city,
   photo:user.photo
   },
   ads: ads,
   adsCount: ads.length
  });

 }catch(e){

  console.log("USER API ERROR:",e);
  res.json({success:false});

 }

});

// ================= AUTO DELETE EXPIRED ADS + PHOTOS =================

setInterval(async () => {

 try {

  const now = Date.now();

  // 1️⃣ Find expired ads
  const expiredAds = await Ad.find({
   expireAt: { $lt: now }
  });

  if(expiredAds.length === 0) return;

  console.log("🕒 Expired ads found:", expiredAds.length);

  // 2️⃣ Delete photos
  for(const ad of expiredAds){

   if(ad.photos && ad.photos.length){

    for(const img of ad.photos){

     const filePath = path.join(__dirname, "public", img);

     fs.unlink(filePath, err => {

      if(err){
       console.log("❌ Image delete error:", filePath);
      }else{
       console.log("🗑 Image deleted:", filePath);
      }

     });

    }

   }

  }

  // 3️⃣ Delete ads from DB
  const result = await Ad.deleteMany({
   expireAt: { $lt: now }
  });

  console.log("🗑 Ads deleted:", result.deletedCount);

 } catch (e) {

  console.log("AUTO DELETE ERROR:", e);

 }

}, 10 * 60 * 1000); // ҳар 10 дақиқа

// 🔥 KEEP RENDER ALIVE
setInterval(()=>{
 fetch("https://alon.tj").catch(()=>{});
}, 240000); // ҳар 4 дақиқа

// ================= AUTO DELETE ORPHAN IMAGES (24h) =================

setInterval(async ()=>{

 try{

  const uploadsPath = path.join(__dirname,"public/uploads");

  if(!fs.existsSync(uploadsPath)) return;

  // 1️⃣ ҳамаи файлҳо дар uploads
  const files = fs.readdirSync(uploadsPath);

  if(!files.length) return;

  // 2️⃣ ҳамаи суратҳое ки дар Mongo истифода мешаванд
  const ads = await Ad.find({}, "photos").lean();

  const usedImages = new Set();

  ads.forEach(ad=>{
   if(ad.photos && ad.photos.length){
    ad.photos.forEach(p=>{
     usedImages.add(path.basename(p));
    });
   }
  });

  // 3️⃣ санҷиш ва delete
  for(const file of files){

   if(!usedImages.has(file)){

    const fullPath = path.join(uploadsPath,file);

    fs.unlink(fullPath, err=>{
     if(err){
      console.log("❌ Orphan delete error:", file);
     }else{
      console.log("🗑 Orphan image deleted:", file);
     }
    });

   }

  }

 }catch(e){
  console.log("ORPHAN CLEAN ERROR:",e);
 }

}, 24 * 60 * 60 * 1000); // ҳар 24 соат

// ================= USER STATS ONLY =================

app.get("/api/stats", async (req, res) => {
 try {
  const users = await User.countDocuments();

  res.json({
   users
  });

 } catch (e) {
  console.log("STATS API ERROR:", e);
  res.status(500).json({ error: true });
 }
});

// ================= START =================

server.listen(PORT,()=>{
 console.log("🚀 Server running http://localhost:"+PORT);
});
