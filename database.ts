import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import sqlite3 from "sqlite3";
    
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = __dirname + "/.data/connect_v1.0.0.db";

const dbExists = existsSync(dbPath);

export const database = new sqlite3.Database(dbPath);

export const all = promisify(database.all.bind(database));
export const run = promisify(database.run.bind(database));

export default {all, run};

if(!dbExists) {
    // set up tables
    database.run(`
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

    database.run(`
      CREATE TABLE rooms(
        key INTEGER PRIMARY KEY,
        roomId TEXT,
        createdAt INT,
        gameId TEXT
      )    
  `);

}

// // Execute SQL statements from strings.
// database.exec(`
//   CREATE TABLE data(
//     key INTEGER PRIMARY KEY,
//     value TEXT
//   ) STRICT
// `);
// // Create a prepared statement to insert data into the database.
// const insert = database.prepare('INSERT INTO data (key, value) VALUES (?, ?)');
// // Execute the prepared statement with bound values.
// insert.run(1, 'hello');
// insert.run(2, 'world');
// // Create a prepared statement to read data from the database.
// const query = database.prepare('SELECT * FROM data ORDER BY key');
// // Execute the prepared statement and log the result set.
// console.log(query.get());
// // Prints: [ { key: 1, value: 'hello' }, { key: 2, value: 'world' } ]