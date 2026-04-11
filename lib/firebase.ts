import { getApp, getApps, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const databaseURL =
  "https://safari-tracker-f83da-default-rtdb.asia-southeast1.firebasedatabase.app/";

const app =
  getApps().length === 0
    ? initializeApp({ databaseURL })
    : getApp();

const database = getDatabase(app);

export const db = database;
export default db;
