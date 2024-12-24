import { ConnInfo, serve } from "denoHttp";
import { Server as SocketIOServer, Socket } from "socket.io";
import { Application, Router, send } from "oak";

import database from "./database.ts";
import { joinRoom, createRoom, leaveRoom, updatePing, fetchUserByToken, fetchUserBySocketId } from "./helpers.ts";

const io = new SocketIOServer();

// Create an Oak app
const app = new Application();
const router = new Router();

router.get("/", async (ctx) => {
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


io.on("connection", socket => {

    socket.on("createRoom", gameId => {
        console.log("CREATING ROOM");
        if(!gameId) {
            socket.emit("error", "please specify a gameid");
            return;
        }
        const roomId = createRoom(gameId);
        socket.emit("createdRoom", roomId);
    });

    interface Logic {
        register_events(socket: Socket): void,
        init_data(roomId: string): void
    }
    const installed_logic: Record<string, Logic> = {
        "qwixx": {
            init_data(roomId: string): void {


            },
            register_events(socket: Socket): void {
                socket.on("startGame", userKey => {
                    const user = fetchUserByToken(userKey);

                    console.log("QWIXX");
            
                    if(!user){
                        socket.emit("error", "invalid key provided")
                        return;
                    }
            
                    if (!user.isHost) {
                        socket.emit("error", "user is not the host");
                        return;
                    }

                    const userList = database.query(`
                        SELECT userId
                        FROM users
                        WHERE roomId=?
                        ORDER BY key ASC
                        LIMIT 1`, 
                    [user.roomId]);

                    if(userList.length == 0) {
                        socket.emit("error", 'no users in this room');
                        return;
                    }

                    console.log("ROOMDATA", user);

                    const default_room_data = {
                        "turnUser": userList[0][0] as string,
                        "roundIndex": 0, // the current turn
                        "latestRoll": [
                            "4", "3", "6", "1", "3", "5" // R Y G B W W 
                        ], 
                        "locks": [
                            null, null, null, null
                        ]
                    };
    
                    database.query(`
                        UPDATE rooms
                        SET roomData=?
                        WHERE roomId=?`,
                    [JSON.stringify(default_room_data), user.roomId]);
                });

                socket.on("qwixx:roll", userKey => {
                    console.log("ROLL");
                    const userList = database.query(`
                        SELECT roomId
                        FROM users
                        WHERE userKey=?`,
                        [userKey]);

                    if (userList.length == 0) {
                        socket.emit("error", { message: "no such token found! action qwixx:roll" });
                        return;
                    }

                    // TODO: only allow one roll per round
                    const [user] = userList;

                    const roomJson = getRoomDataJSON(user[0] as string);
                    if (!roomJson) {
                        return;
                    }

                    const red = Math.floor(Math.random() * 6) + 1;
                    const yellow = Math.floor(Math.random() * 6) + 1;
                    const green = Math.floor(Math.random() * 6) + 1;
                    const blue = Math.floor(Math.random() * 6) + 1;
                    const white1 = Math.floor(Math.random() * 6) + 1;
                    const white2 = Math.floor(Math.random() * 6) + 1;

                    roomJson.latestRoll = [red, yellow, green, blue, white1, white2];
                    const roomText = JSON.stringify(roomJson);
                    database.query(`
                        UPDATE rooms 
                        SET roomData=?
                        WHERE roomId=?`, 
                    [roomText, user[0] as string]);

                    io.to(user[0] as string).emit("qwixx:rollResult", {
                        red, yellow, green, blue, white1, white2
                    });

                });

                interface RoomData {
                    roundIndex: number,
                    turnUser: string,
                    latestRoll: number[],
                    locks: (number | null)[]
                }

                function getRoomDataJSON(roomId: string): RoomData | null {
                    const roomList = database.query(`
                        SELECT roomData
                        FROM rooms
                        WHERE roomId=?`,
                        [roomId]);

                    if (roomList.length == 0) {
                        return null;
                    }

                    const roomJson = JSON.parse(roomList[0][0] as string);
                    return roomJson as RoomData;
                }

                interface UserData {
                    latestRoundIndex: number,
                    boardState: string[]
                    markAsset: string,
                    penalty: number
                }

                function getUserDataJSON(userId: string): UserData | null {
                    const userList = database.query(`
                        SELECT userData
                        FROM users
                        WHERE userId=?`,
                        [userId]);

                    if (userList.length == 0) {
                        return null;
                    }

                    const userJson = JSON.parse(userList[0][0] as string);
                    return userJson as UserData;
                }

                function checkNextRound(roomId: string): void {
                    const userList = database.query(`
                        SELECT userData
                        FROM users
                        WHERE roomId=?
                        ORDER BY key ASC`,
                        [roomId]);

                    const roomJson = getRoomDataJSON(roomId);
                    if (roomJson == null) {
                        return;
                    }

                    const { roundIndex, turnUser } = roomJson;
                    for (let i = 0; i < userList.length; i++) {
                        const userJson = JSON.parse(userList[i][0] as string);
                        if (userJson.turn < roundIndex) { // this user hasn't finished yet
                            return;
                        }
                    }

                    const currentTurnId: number = userList.flat().indexOf(turnUser);
                    const newTurnUser: string = userList[(currentTurnId + 1) % userList.length][0] as string

                    roomJson.turnUser = newTurnUser;
                    roomJson.roundIndex += 1;

                    // update the roomdata in db
                    const roomText = JSON.stringify(roomJson);
                    database.query(`
                        UPDATE rooms
                        SET roomData=?
                        WHERE roomId=?`,
                        [roomText, roomId]);

                    io.to(roomId).emit("qwixx:currentTurn", newTurnUser);
                }

                function validateMove(play: string, boardState: string[], latestRoll: number[], isSpecial: boolean): boolean {
                    const rowList = ["A", "B", "C", "D"];

                    const playRow = play[0];
                    if (!rowList.includes(playRow)) {
                        return false;
                    }

                    const playNumber = parseInt(play.substring(1));
                    // ensure this play corresponds with the dice

                    const [A, B, C, D, W, WW] = latestRoll;
                    if (isSpecial) {
                        const colorRoll = [A, B, C, D];
                        const rowRoll = colorRoll[rowList.indexOf(playRow)];

                        if (
                            rowRoll + W !== playNumber &&
                            rowRoll + WW !== playNumber
                        ) {
                            return false;
                        }
                    } else if (W + WW !== playNumber) {
                        return false;
                    }

                    const otherRow = boardState
                        .filter(x => x.startsWith(playRow));

                    // ensure there are no other plays after this one
                    for (let i = 0; i < otherRow.length; i++) {
                        const otherNumber = parseInt(otherRow[i].substring(1));
                        if (otherNumber > playNumber) {
                            return false;
                        }
                    }

                    // check locks
                    if (["A12", "B12", "C2", "D2"].includes(play) && otherRow.length < 5) {
                        return false;
                    }

                    return true;
                }

                socket.on("qwixx:play", (userKey: string, play: (string | null)[]) => {

                    // normal  special
                    // play: ["A7", "A8"]
 
                    // TODO turn validation
                    // TODO validate move with stored dice from roomdb, and user's board state, and locks (>5, etc)

                    const user = fetchUserByToken(userKey);
                    if (!user) {
                        socket.emit("error", "no such user with token, action qwixx:play");
                        return;
                    }

                    const roomJson = getRoomDataJSON(user.roomId);
                    if (roomJson == null) {
                        socket.emit("error", "could not find the room this user is a part of");
                        return;
                    }

                    // TODO: validate the user's play and add it to the database
                    const userJson = getUserDataJSON(user.userId);
                    if (userJson == null) {
                        console.log("Couldn't find this user??")
                        return;
                    }

                    const { boardState, latestRoundIndex } = userJson;

                    if (latestRoundIndex !== roomJson.roundIndex) {
                        socket.emit("You have already played this round")
                        return;
                    }

                    const [normal, special] = play;

                    if (normal !== null) {
                        const isValidMove = validateMove(normal, boardState, roomJson.latestRoll, false);
                        if (!isValidMove) {
                            socket.emit("error", "invalid play: can't play " + normal);
                            return;
                        }

                        // save to db
                        userJson.boardState.push(normal);

                        // add lock if applicable (already validated above)
                        if (["A12", "B12", "C2", "D2"].includes(normal)) {
                            const row = normal[0];
                            userJson.boardState.push(row + "L");
                            roomJson.locks[["A", "B", "C", "D"].indexOf(row)] = roomJson.roundIndex;
                        }
                        
                        io.to(user.roomId).emit("qwixx:play", { userId: user.userId, play: normal });
                    }
                    
                    // special play
                    if (roomJson.turnUser == user.userId && special !== null) {
                        const isValidMove = validateMove(special, boardState, roomJson.latestRoll, true);
                        if (!isValidMove) {
                            socket.emit("error", "invalid play: can't play " + normal);
                            return;
                        }
                        
                        // save to db
                        userJson.boardState.push(special);
                        
                        // add lock if applicable (already validated above)
                        if (["A12", "B12", "C2", "D2"].includes(special)) {
                            const row = special[0];
                            userJson.boardState.push(row + "L");
                            roomJson.locks[["A", "B", "C", "D"].indexOf(row)] = roomJson.roundIndex;
                        }

                        io.to(user.roomId).emit("qwixx:play", { userId: user.userId, play: special });
                    }

                    userJson.latestRoundIndex += 1;
                    if(normal == null && special == null) {
                        userJson.penalty += 5;
                    }

                    // save the new json
                    const userText = JSON.stringify(userJson);
                    database.query(`
                        UPDATE users
                        SET userData=?
                        WHERE userId=?`,
                        [userText, user.userId]);

                    checkNextRound(user.roomId);
                });
            }
        }, "splendor": {
            init_data(roomId: string): void {

            },
            register_events(socket: Socket): void {

            }
        }
    };

    socket.on("joinRoom", roomId => {
        const { userId, room, userKey } = joinRoom(roomId, socket.id);
        if (userId && room) {
            // initialize server side logic (if applicable)
            if (room.gameId !== "decentralized") {
                // run the stuff
                const game_logic = installed_logic[room.gameId];
                if (game_logic) {
                    game_logic.register_events(socket);
                }
            }

            // emit user details
            socket.join(roomId);
            socket.join(userId);
            socket.emit("joinedRoom", [userId, userKey]);
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

    socket.on("startGame", userKey => {
        const user = fetchUserByToken(userKey);
        console.log("START GAME");
        console.log(user);

        if(!user){
            socket.emit("error", "invalid key provided")
            return;
        }

        if (!user.isHost) {
            socket.emit("error", "user is not the host");
            return;
        }

        database.query(`
            UPDATE rooms
            SET isWaiting=0
            WHERE roomId=?`, 
        [user.roomId]);

        io.to(user.roomId).emit("startGame");
    });

    socket.on("disconnect", () => {
        const user = fetchUserBySocketId(socket.id);
        if (user) {
            setTimeout(() => {

            })
        }
    });

    // socket.on("ping", () => {
    //     updatePing(socket.id);
    //     socket.emit("pong");
    // });


    // game specific management functions
    // socket.on("play");

//     socket.on("diceRoll", dice => {

//         // const valid = await validateTurnToken();
//         const result = dice.map((x: number) => Math.floor(Math.random() * x));
//         const userList = database.query(`
//             SELECT roomId 
//             FROM users 
//             WHERE socketId=?
//         `, [socket.id]);

//         if (userList.length > 0) {
//             const roomId = userList[0][0] as string;
//             io.to(roomId).emit("diceRollResult", result);
//         }
//     });
});

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
console.log("Server is running on http://localhost:3000/");
serve(handler, { port: 3000 });