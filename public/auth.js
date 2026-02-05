import { auth } from "/firebase.js";

import {
 GoogleAuthProvider,
 signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const btn = document.getElementById("googleLogin");

const provider = new GoogleAuthProvider();

btn.onclick = async () => {

 try{

  const result = await signInWithPopup(auth, provider)

  const user = result.user;

  // SEND TO SERVER
  const res = await fetch("/firebase-login", {
   method:"POST",
   headers:{
    "Content-Type":"application/json"
   },
   body: JSON.stringify({
    uid: user.uid,
    name: user.displayName,
    email: user.email,
    photo: user.photoURL
   })
  });

  const data = await res.json();

  if(data.success){
   location.href = "/profile";
  }

 }catch(e){
  alert(e.message);
 }

};



