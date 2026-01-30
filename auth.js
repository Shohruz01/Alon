с	import { auth } from "./firebase.js";
import { 
 GoogleAuthProvider,
 signInWithPopup,
 onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const btn = document.getElementById("googleLogin");

const provider = new GoogleAuthProvider();

/* LOGIN CLICK */

btn.addEventListener("click", () => {

 signInWithPopup(auth, provider)
 .then((result) => {

   console.log("Logged:", result.user.uid);

   localStorage.setItem("uid", result.user.uid);

   window.location.href = "home.html";

 })
 .catch(err => {
   alert(err.message);
 });

});

/* AUTO REDIRECT IF ALREADY LOGIN */

onAuthStateChanged(auth, user => {

 if(user){
  window.location.href = "home.html";
 }

});
