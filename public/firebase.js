import { initializeApp } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import { getAuth } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
 apiKey: "AIzaSyD678JabDd5N-kcAme_lYxr867IhFC_peo",
 authDomain: "surh-40611.firebaseapp.com",
 projectId: "surh-40611",
 storageBucket: "surh-40611.appspot.com",
 messagingSenderId: "1013895568244",
 appId: "1:1013895568244:web:1db0f60c1affe39e226a21"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

