import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { DB } from "https://deno.land/x/sqlite/mod.ts";

// Open or create a SQLite database file
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = __dirname + "/.data/connect_v1.0.0.db";

const dbExists = existsSync(dbPath);

const db = new DB("example.db");
export default db;

if(!dbExists) {
  // set up tables
  db.query(`
      CREATE TABLE users(
        key INTEGER PRIMARY KEY,
        userId TEXT,
        createdAt INT,
        socketId TEXT,
        lastPingAt INT,
        isHost BOOL,
        turnIdx INT
      )    
  `);

  db.query(`
    CREATE TABLE rooms(
      key INTEGER PRIMARY KEY,
      roomId TEXT,
      createdAt INT,
      gameId TEXT
    )    
`);

}

// Insert some data
// db.query("INSERT INTO users (name, email) VALUES (?, ?)", ["John Doe", "john@example.com"]);

// Query the database
// const users = db.query("SELECT * FROM users");
// for (const [id, name, email] of users) {
//   console.log(`${id}: ${name} (${email})`);
// }

// Close the database
// db.close();
