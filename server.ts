import { ConnInfo, serve } from "denoHttp";
import { Server as SocketIOServer } from "socket.io";
import { Application, Router, send } from "oak";

import database from "./database.ts";
import crypto from "node:crypto";

const io = new SocketIOServer();

// Handle Socket.IO events
io.on("connection", (socket) => {
    console.log(`Socket ${socket.id} connected`);

    socket.emit("hello", "world");

    socket.on("disconnect", (reason) => {
        console.log(`Socket ${socket.id} disconnected due to ${reason}`);
    });
});

// Create an Oak app
const app = new Application();
const router = new Router();

router.get("/", (ctx) => {
    ctx.response.body = "Hello from Oak!";
});

router.use((ctx) => {
    ctx.response.body = "404 error";
});

app.use(router.routes());
app.use(router.allowedMethods());

interface User {
    userId: string,
    roomId: string,
    turnIdx: number
}

async function joinRoom(roomId: string, socketId: string): Promise<string | null> {
    const roomList = await database.run(`
        SELECT * FROM rooms WHERE roomId=?
    `, roomId);

    // emit error if room not found
    if (roomList.length == 0) {
        return null;
    }

    // clear out any other users
    await database.run(`DELETE FROM users WHERE socketId=?`, socketId);

    // create a new user instance
    const thisUserId = crypto.randomBytes(8).toString("hex");
    const nowTime = Date.now();

    // get the next turn index
    const userList = database.run(`
        SELECT turnIdx 
        FROM users 
        WHERE roomId=?`,
        roomId);

    const nextIdx = userList.length == 0 ?
        0 :
        Math.max(userList.map((x: User) => x.turnIdx)) + 1;

    await database.run(`
        INSERT INTO users
        (userId, roomId, createdAt, socketId, isHost, lastPingAt, turnIdx)
        VALUES (?,?,?,?,?,?,?)
    `, thisUserId, roomId, nowTime, socketId, 0, nowTime, nextIdx);

    return thisUserId;
}

async function leaveRoom(socketId: string): Promise<{ userId: string; roomId: string } | null> {
    const userList = await database.all(`
        SELECT userId,roomId 
        FROM users 
        WHERE socketId=?`,
        socketId);

    if (userList.length == 0) {
        return null;
    }

    const thisUser = userList[0];
    await database.run("DELETE FROM users WHERE userId=?", thisUser.userId);

    return thisUser;
}

async function updatePing(socketId: string): Promise<void> {
    await database.run(`
        UPDATE users 
        SET lastPingAt=?
        WHERE socketId=?`,
        Date.now(), socketId);
}

async function validateTurnToken(turnToken: string) {
    await database.all("SELECT * FROM turns WHERE turnToken=?", turnToken);


}

io.on("connection", socket => {
    socket.on("joinRoom", async roomId => {
        const userId = await joinRoom(roomId, socket.id);
        if (userId) {
            // emit user details
            socket.emit("joinedRoom", userId);
        } else {
            socket.emit("error", {
                message: `no such roomId ${roomId}`
            });
        }
    });

    socket.on("leaveRoom", async () => {
        const thisUser = await leaveRoom(socket.id);

        if (!thisUser) { return; }
        io.to(thisUser.roomId).emit("userLeave", thisUser);
    });

    socket.on("ping", async () => {
        await updatePing(socket.id);
        socket.emit("pong");
    })


    // game specific management functions
    // socket.on("play");

    socket.on("diceRoll", async (dice, turnToken) => {

        // const valid = await validateTurnToken();
        const result = dice.map((x: number) => Math.floor(Math.random() * x));
        const userList = await database.all(`
            SELECT roomId FROM users WHERE socketId=?
        `, socket.id);

        if (userList.length > 0) {
            io.to(userList[0].roomId).emit("diceRollResult", result);
        }
    });
});

console.log("server listening");
// Combine Oak's handler with the Socket.IO handler
const handler = async (request: Request, connInfo: ConnInfo): Promise<Response> => {
    // Let Socket.IO handle the WebSocket upgrade requests
    const socketIOHandler = io.handler();
    const response = await socketIOHandler(request, connInfo);

    // If Socket.IO didn't handle the request, fall back to Oak
    if (response.status === 404) {
        return (await app.handle(request))!;
    }

    return response;
};

// Start the combined server
console.log("Server is running on http://localhost:3000");
serve(handler, { port: 3000 });