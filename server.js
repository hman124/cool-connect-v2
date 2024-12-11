import express from "express";
import socket from "socket.io";
import http from "node:http";

import bodyParser from "body-parser";
import cookieParser from "cookie-parser";

import cors from "cors";

import database from "./database.js";

const app = express();
const httpServer = http.createServer(app);

const io = new socket.Client({
    cors: {}
}, httpServer);

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(cookieParser());

io.on("connection", socket => {
    socket.on("joinRoom", async roomId => {
        const roomList = await database.run(`
            SELECT * FROM rooms WHERE roomId=?
        `, roomId);

        if(roomList.length > 0){
            const thisUserId = crypto.randomBytes(8).toString("hex");
            const nowTime = Date.now();
            await database.run(`
                INSERT INTO users
                (userId, roomId, createdAt, socketId, isHost, lastPingAt)
                VALUES (?,?,?,?,?,?)
            `, thisUserId, roomId, nowTime, socket.id, 0, nowTime);

            socket.emit("joinedRoom", userId);
        } else {
            socket.emit("error", {
                message: `no such roomId ${roomId}`
            });
        }
    });

    socket.on("leaveRoom", (userId) => {

    });
});

httpServer.listen(process.env.PORT || 3000);