const admin = require("firebase-admin");

const serviceAccount = require("../../promptly-c3fc2-firebase-adminsdk-9ojxt-5ef13291e4.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const db = admin.firestore();
