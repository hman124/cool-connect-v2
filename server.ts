import { ConnInfo, serve } from "denoHttp";
import { Server as SocketIOServer } from "socket.io";
import { Application, Router, send } from "oak";

import database from "./database.ts";
import crypto from "node:crypto";
import { createBrotliCompress } from "node:zlib";

const io = new SocketIOServer();

// Create an Oak app
const app = new Application();
const router = new Router();

router.get("/", async (ctx) => {
    ctx.response.body = "Hello from Oak!";
    await send(ctx, "index.html", {
        root: "./views"
    })
});

app.use(router.routes());
app.use(router.allowedMethods());

app.use((ctx) => {
    ctx.response.body = "404 error";
    ctx.response.status = 404;
});

function joinRoom(roomId: string, socketId: string): string | null {
    const roomList = database.query(`
        SELECT * FROM rooms WHERE roomId=?
    `, [roomId]);

    // emit error if room not found
    if (roomList.length == 0) {
        return null;
    }

    const userLength: number = database.query(`
        SELECT userId 
        FROM users 
        WHERE roomId=?`, 
        [roomId]
    ).length;

    // clear out any other users
    database.query(`DELETE FROM users WHERE socketId=?`, [socketId]);

    // create a new user instance
    const userId = crypto.randomBytes(8).toString("hex");
    const userKey = crypto.randomBytes(12).toString("hex");

    database.query(`
        INSERT INTO users
        (userId, roomId, createdAt, socketId, isHost, lastPingAt, userKey)
        VALUES (?,?,?,?,?,?,?,?)
    `, [userId, roomId, Date.now(), socketId, userLength == 0, Date.now(),userKey]);

    return userId;
}

function leaveRoom(socketId: string): { userId: string; roomId: string } | null {

    const userList = database.query(`
        SELECT userId,roomId 
        FROM users 
        WHERE socketId=?`,
        [socketId]);

    if (userList.length == 0) {
        return null;
    }

    const thisUser = userList[0];
    const [userId, roomId]: [string, string] = thisUser[0] as [string, string];
    database.query("DELETE FROM users WHERE userId=?", [userId]);

    return { userId, roomId };
}

function updatePing(socketId: string): void {
    database.query(`
        UPDATE users 
        SET lastPingAt=?
        WHERE socketId=?`,
        [Date.now(), socketId]
    );
}

function createRoom(): string {
    const roomId: string = crypto.randomBytes(4).toString("hex");

    database.query(`
        INSERT INTO rooms (roomId, createdAt) 
        VALUES (?,?)`, 
        [roomId, Date.now()]
    );

    return roomId;
}

function validateTurnToken(turnToken: string) {
    database.query("SELECT * FROM turns WHERE turnToken=?", [turnToken]);
}

io.on("connection", socket => {

    socket.on("createRoom", () => {
        console.log("CREATING ROOM");
        const roomId = createRoom();
        socket.emit("createdRoom", roomId);
    });

    socket.on("joinRoom", roomId => {
        const userId = joinRoom(roomId, socket.id);
        if (userId) {
            // emit user details
            socket.emit("joinedRoom", userId);
        } else {
            socket.emit("error", {
                message: `no such roomId ${roomId}`
            });
        }
    });

    socket.on("leaveRoom", () => {
        const thisUser = leaveRoom(socket.id);

        if (!thisUser) { return; }
        io.to(thisUser.roomId).emit("userLeave", thisUser);
    });

    socket.on("ping", () => {
        updatePing(socket.id);
        socket.emit("pong");
    })


    // game specific management functions
    // socket.on("play");

    socket.on("diceRoll", (dice, turnToken) => {

        // const valid = await validateTurnToken();
        const result = dice.map((x: number) => Math.floor(Math.random() * x));
        const userList = database.query(`
            SELECT roomId FROM users WHERE socketId=?
        `, [socket.id]);

        if (userList.length > 0) {
            const roomId = userList[0][0] as string;
            io.to(roomId).emit("diceRollResult", result);
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