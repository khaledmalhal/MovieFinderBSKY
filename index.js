"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@atproto/api");
const dotenv = __importStar(require("dotenv"));
const process = __importStar(require("process"));
const postgres_1 = __importDefault(require("postgres"));
dotenv.config();
const sql = (0, postgres_1.default)({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: 'psql'
});
// Create a Bluesky Agent
const agent = new api_1.BskyAgent({
    service: 'https://bsky.social',
});
async function login() {
    await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD });
}
async function getUnreadCount() {
    return await new Promise((resolve) => {
        const interval = setInterval(async () => {
            try {
                let res = await agent.countUnreadNotifications({});
                if (res.success && res.data.count > 0) {
                    clearInterval(interval);
                    resolve(res.data.count);
                }
            }
            catch (error) {
                console.error(error);
                return -1;
            }
        }, 1000);
    });
}
async function listNotifications() {
    try {
        let res = await agent.listNotifications();
        if (res.success) {
            return res.data.notifications;
        }
    }
    catch (error) {
        console.error(error);
        return [];
    }
}
async function getDescriptionFromPost(post) {
    return await new Promise(async (resolve) => {
        const rt = new api_1.RichText({
            text: post.text
        });
        await rt.detectFacets(agent);
        let description = "";
        for (const segment of rt.segments()) {
            if (!(segment.isLink() || segment.isMention() || segment.isTag())) {
                console.log(`Plain text: ${segment.text}`);
                description += segment.text;
            }
        }
        resolve(description);
    });
}
async function consultMovies(description) {
    return await new Promise(async (resolve) => {
        const movies = await sql `
        SELECT
            title,
            release_date,
            embedding <=>  ai.ollama_embed('nomic-embed-text', ${description}, host => 'http://ollama:11434') as distance
        FROM movies.movies_overview_embedding
        ORDER BY distance ASC
        LIMIT 5;
        `;
        let reply = '';
        movies.forEach(movie => {
            reply += `${movie['title']}\n`;
        });
        resolve(reply);
    });
}
async function replyToPost(post, text) {
    text = text.trim();
    if (text.length == 0) {
        console.log("Text is empty");
        return;
    }
    await agent.post({
        text: text,
        reply: {
            root: {
                uri: post.uri,
                cid: post.cid,
            },
            parent: {
                uri: post.uri,
                cid: post.cid,
            }
        },
        createdAt: new Date().toISOString()
    });
}
async function main() {
    await login();
    while (true) {
        console.log("Awaiting for unread counts");
        let count = await getUnreadCount()
            .then((count) => {
            console.log(`Finished getting unread counts ${count}`);
        });
        let list = await listNotifications();
        for (let i in list) {
            let notf = list[i];
            if (notf.isRead == true)
                continue;
            if (notf.reason != 'mention') {
                console.warn(`Notification ${notf.uri} is not a mention (${notf.reason})`);
                continue;
            }
            const post = await agent.getPosts({ uris: [notf.uri] });
            post.data.posts.forEach(async (post) => {
                await getDescriptionFromPost(post.record)
                    .then((description) => {
                    console.log(`Got description ${description}`);
                    consultMovies(description)
                        .then((reply) => {
                        console.log(`Gotten movies ${reply}`);
                        replyToPost(post, reply);
                    });
                });
            });
        }
        await agent.updateSeenNotifications(new Date().toISOString());
    }
}
main();
