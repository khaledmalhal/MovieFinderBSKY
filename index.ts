import { BskyAgent, RichText } from '@atproto/api';
import * as dotenv from 'dotenv';
import * as process from 'process';
import postgres from 'postgres';

dotenv.config();

const sql = postgres({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: 'psql'
})

// Create a Bluesky Agent
const agent = new BskyAgent({
    service: 'https://bsky.social',
    })


async function login() {
    await agent.login({ identifier: process.env.BLUESKY_USERNAME!, password: process.env.BLUESKY_PASSWORD!})
}

async function getUnreadCount() {
    return await new Promise((resolve) => {
        const interval = setInterval(async () => {
            try {
                let res = await agent.countUnreadNotifications({ })
                if (res.success && res.data.count > 0) {
                    clearInterval(interval)
                    resolve(res.data.count)
                }
            } catch (error) {
                console.error(error)
                return -1;
            }
        }, 1000)
    })
}

async function listNotifications() {
    try {
        let res = await agent.listNotifications()
        if (res.success) {
            return res.data.notifications
        }
    }
    catch (error) {
        console.error(error)
        return []
    }
}

async function getDescriptionFromPost(post) {
    return await new Promise(async (resolve) => {
        const rt = new RichText({
            text: post.text
        })
        await rt.detectFacets(agent)
        let description : string = ""
        for (const segment of rt.segments()) {
            if (!(segment.isLink() || segment.isMention() || segment.isTag())) {
                console.log(`Plain text: ${segment.text}`)
                description += segment.text
            }
        }
        resolve(description)
    })
}

async function consultMovies(description) {
    return await new Promise(async (resolve) => {
        const movies = await sql`
        SELECT
            title,
            release_date,
            embedding <=>  ai.ollama_embed('nomic-embed-text', ${ description }, host => 'http://ollama:11434') as distance
        FROM movies.movies_overview_embedding
        ORDER BY distance ASC
        LIMIT 5;
        `
        let reply : string = ''
        movies.forEach(movie => {
            reply += `${movie['title']}\n`
        })
        resolve(reply)
    })
}

async function replyToPost(post, text) {
    text = text.trim()
    if (text.length == 0) {
        console.log("Text is empty")
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
    })
}

async function main() {
    await login();

    while (true) {
        console.log("Awaiting for unread counts")
        let count = await getUnreadCount()
        .then((count) => {
            console.log(`Finished getting unread counts ${count}`)
        })

        let list = await listNotifications()
        for (let i in list) {
            let notf = list[i]
            if (notf.isRead == true)
                continue
            if (notf.reason != 'mention') {
                console.warn(`Notification ${notf.uri} is not a mention (${notf.reason})`)
                continue
            }
            const post = await agent.getPosts({ uris: [notf.uri] })
            post.data.posts.forEach(async (post) => {
                await getDescriptionFromPost(post.record)
                .then((description) => {
                    console.log(`Got description ${description}`)
                    consultMovies(description)
                    .then((reply) => {
                        console.log(`Gotten movies ${reply}`)
                        replyToPost(post, reply)
                    })
                })
            });
        }
        await agent.updateSeenNotifications(new Date().toISOString())
    }
}

main()
