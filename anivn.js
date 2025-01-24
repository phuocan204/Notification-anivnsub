const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const config = require('./config.json');
const { webhook_url, anime_url } = config;

const processedAnimeMemoryFile = path.join(__dirname, 'AnimeVnSub.json');

let processedAnimeMemory = {};
if (fs.existsSync(processedAnimeMemoryFile)) {
    const data = fs.readFileSync(processedAnimeMemoryFile, 'utf8');
    processedAnimeMemory = JSON.parse(data);
}

async function fetchAnimeData(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const animes = await page.evaluate(() => {
        const animeElements = document.querySelectorAll('.MovieList .TPostMv');
        const animeList = [];

        animeElements.forEach(el => {
            const title = el.querySelector('.Title')?.innerText.trim();
            const episode = el.querySelector('.mli-eps i')?.innerText.trim();
            const link = el.querySelector('a')?.href;
            const image = el.querySelector('img')?.src;
            const rating = el.querySelector('.anime-avg-user-rating')?.innerText.trim();
            const genres = Array.from(el.querySelectorAll('.Genre a')).map(genre => genre.innerText.trim()).join(', ');

            if (title && episode && link) {
                animeList.push({ title, episode, link, image, rating, genres });
            }
        });

        return animeList;
    });

    await browser.close();
    return animes;
}

async function fetchAnimeDescription(link) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(link, { waitUntil: 'domcontentloaded' });

    const description = await page.evaluate(() => {
        const descElement = document.querySelector('.Description');
        return descElement ? descElement.innerText.trim() : 'Không có gì.';
    });

    const backgroundImage = await page.evaluate(() => {
        const imageElement = document.querySelector('.TPostBg.Objf img');
        return imageElement ? imageElement.src : '';
    });

    await browser.close();
    return { description, backgroundImage };
}

async function sendWebhook(anime) {
    try {
        const message = {
            embeds: [
                {
                    author: {
                        name: 'Animevietsub',
                        url: anime_url,
                    },
                    title: `${anime.title} (Tập ${anime.episode})`,
                    url: anime.link,
                    description: `**Đánh giá:** ${anime.rating}\n**Thể loại:** ${anime.genres}\n\n**Giới thiệu:** ${anime.description}`,
                    color: 0x1abc9c,
                    image: { url: anime.backgroundImage || anime.image },
                    thumbnail: { url: anime.image },
                },
            ],
        };

        await axios.post(webhook_url, message, { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('Lỗi khi gửi webhook:', error.message);
    }
}

const MAX_ANIME_COUNT = 30; // Giới hạn lưu trữ

async function checkAnimeUpdates(url) {
    const animes = await fetchAnimeData(url);
    if (animes.length === 0) return;

    const processedAnime = processedAnimeMemory[url] || [];
    const newAnime = animes[0];

    const isProcessed = processedAnime.some(anime => anime.link === newAnime.link);
    if (!isProcessed) {

        const { description, backgroundImage } = await fetchAnimeDescription(newAnime.link);
        newAnime.description = description;
        newAnime.backgroundImage = backgroundImage;

        await sendWebhook(newAnime);

        processedAnimeMemory[url] = [newAnime, ...processedAnime];

        if (processedAnimeMemory[url].length > MAX_ANIME_COUNT) {
            processedAnimeMemory[url] = processedAnimeMemory[url].slice(0, MAX_ANIME_COUNT);
        }

        fs.writeFileSync(processedAnimeMemoryFile, JSON.stringify(processedAnimeMemory, null, 2), 'utf8');
    }
}

(async () => {
    await checkAnimeUpdates(anime_url);

    setInterval(async () => {
        await checkAnimeUpdates(anime_url); // Kiểm tra cập nhật
    }, 5000);
})();
