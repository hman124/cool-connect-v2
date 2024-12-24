import database from "./database.ts";
import crypto from "node:crypto";

interface Room {
    roomId: string,
    createdAt: number,
    gameId: string
}

export function fetchRoom(roomId: string): Room | null {

    const roomList = database.query(`
        SELECT roomId, createdAt, gameId
        FROM rooms 
        WHERE roomId=?`, [roomId]);

    if (roomList.length == 0) {
        return null;
    }

    const [room] = roomList;

    return {
        roomId: room[0] as string,
        createdAt: room[1] as number,
        gameId: room[2] as string,

    }
}

export function joinRoom(roomId: string, socketId: string): { userId: string | null, room: Room | null, userKey: string | null } {
    const roomTrim = roomId.trim();
    const room = fetchRoom(roomId);

    // emit error if room not found
    if (!room) {
        return { userId: null, room: null, userKey: null };
    }

    const userLength: number = database.query(`
        SELECT userId 
        FROM users 
        WHERE roomId=?`,
        [roomTrim]
    ).length;

    // clear out any other users
    database.query(`DELETE FROM users WHERE socketId=?`, [socketId]);

    // create a new user instance
    const userId = crypto.randomBytes(8).toString("hex");
    const userKey = crypto.randomBytes(12).toString("hex");

    database.query(`
        INSERT INTO users
        (userId, roomId, createdAt, socketId, isHost, lastPingAt, userKey)
        VALUES (?,?,?,?,?,?,?)
    `, [userId, roomTrim, Date.now(), socketId, userLength == 0, Date.now(), userKey]);

    return { userId, room, userKey };
}

export function leaveRoom(socketId: string): { userId: string, roomId: string } | null {

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

export function updatePing(socketId: string): void {
    database.query(`
        UPDATE users 
        SET lastPingAt=?
        WHERE socketId=?`,
        [Date.now(), socketId]
    );
}

export function createRoom(gameId: string): string {
    const roomId: string = crypto.randomBytes(2).toString("hex");

    database.query(`
        INSERT INTO rooms (roomId, createdAt, gameId, isWaiting) 
        VALUES (?,?,?,1)`,
        [roomId, Date.now(), gameId]
    );

    return roomId;
}

interface User {
    roomId: string,
    socketId: string,
    userId: string,
    isHost: boolean
}

// export function fetchUserById(userId: string): User | null {
//     const userList = database.query(`
//         SELECT (roomId,socketId)
//         FROM users
//         WHERE userId=?`,
//         [userId]);

//     if (userList.length == 0) {
//         return null;
//     }

//     const [roomId, socketId] = userList[0] as string[];

//     return {
//         userId,
//         roomId,
//         socketId
//     }
// }

export function fetchUserByToken(userKey: string): User | null {
    const userList = database.query(`
        SELECT roomId, userId, socketId, isHost
        FROM users
        WHERE userKey=?`,
        [userKey]);

    if (userList.length == 0) {
        return null;
    }

    const [roomId, userId, socketId] = userList[0] as string[];
    const isHost = Boolean(userList[0][3] as number);

    return {
        userId,
        roomId,
        socketId,
        isHost
    }
}

export function fetchUserById(userId: string): User | null {
    const userList = database.query(`
        SELECT roomId, socketId, isHost
        FROM users
        WHERE userId=?`,
        [userId]);

    if (userList.length == 0) {
        return null;
    }

    const [roomId, socketId] = userList[0] as string[];
    const isHost = Boolean(userList[0][2] as number);


    return {
        userId,
        roomId,
        socketId,
        isHost
    }
}

export function fetchUserBySocketId(socketId: string): User | null {
    const userList = database.query(`
        SELECT roomId, userId
        FROM users
        WHERE socketId=?`,
        [socketId]);

    if (userList.length == 0) {
        return null;
    }

    const [roomId, userId] = userList[0] as string[];
    const isHost = Boolean(userList[0][2] as number);


    return {
        userId,
        roomId,
        socketId,
        isHost
    }
}