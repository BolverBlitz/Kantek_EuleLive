require('dotenv').config();
const HyperExpress = require('hyper-express');
const Joi = require('joi');
const fs = require('fs');
const pg = require('pg');
const path = require('path');
const puppeteer = require('puppeteer');

const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer');

const fetch = require('cross-fetch');

const cheerio = require('cheerio');

const app = new HyperExpress.Server();
const port = process.env.PORT || 5000;

let blocker; // Adblocker
let messages = [];

const pool = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
})

/**
 * This function will return a limited amount of messages from the database
 * @returns {Promise}
 */
const GetMessages = function (limit = 10) {
    return new Promise(function (resolve, reject) {
        pool.query(`SELECT text, user_id AS user, found_by FROM messages ORDER BY timestamp DESC LIMIT ${limit}`, (err, result) => {
            if (err) { reject(err) }
            resolve(result.rows);
        });
    });
}

const add_message_token = process.env.ADD_MESSAGETOKEN;

const AddMessage = Joi.object({
    text: Joi.string().required(),
    user: Joi.number().required(),
    found_by: Joi.string().required(),
});

const urlSchema = Joi.object({
    url: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .required()
        .external((uri, schema) => {
            if (uri.includes('whatsapp') || uri.includes('telegram')) {
                throw new Error('Links zu WhatsApp und Telegram sind nicht erlaubt');
            }
            return uri;
        })
});

app.get('/', (req, res) => {
    res.header('Content-Type', 'text/html');
    res.send(fs.readFileSync(path.join(__dirname, 'www-public', 'index.html')));
})

app.post('/add_message', async (req, res) => {
    let UserToken = '';
    if (req.headers['authorization'] != undefined) {
        UserToken = req.headers['authorization'].replace('Bearer ', '');
    } else {
        throw new Error('No Token Provided');
    }

    if (UserToken != add_message_token) {
        throw new Error('Invalid Token Provided');
    }

    const value = await AddMessage.validateAsync(await req.json());
    messages.push(value);
    console.log(`New message: ${value.text} (found by ${value.found_by})`);
    app.publish(`/new_message`, JSON.stringify(value));
    res.send('OK');
});

app.ws('/view_messages', {
    idle_timeout: 60
}, (ws) => {
    console.log('Connection opened');
    messages.forEach(element => {
        ws.send(JSON.stringify(element));
    });
    ws.send("HISTORY DONE");
    ws.subscribe(`/new_message`);
    ws.on('close', () => console.log('Connection closed'));
});

app.get('/preview', async (req, res) => {
    try {
        const { url } = await urlSchema.validateAsync(req.query);
        const response = await fetch(url);
        const $ = cheerio.load(await response.text());
        const title = $('head title').text();
        const description = $('head meta[name="description"]').attr('content');
        const image = $('head meta[property="og:image"]').attr('content');

        res.json({ title, description, image });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/screenshot', async (req, res) => {
    const { url } = await urlSchema.validateAsync(req.query); // URL-Parameter validation
    const browser = await puppeteer.launch({ headless: 'new' });

    const page = await browser.newPage();
    await blocker.enableBlockingInPage(page);

    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(url, { waitUntil: ['load', 'domcontentloaded', 'networkidle0'] });

    await page.evaluate(_ => {
        function xcc_contains(selector, text) {
            var elements = document.querySelectorAll(selector);
            return Array.prototype.filter.call(elements, function (element) {
                return RegExp(text, "i").test(element.textContent.trim());
            });
        }
        var _xcc;
        _xcc = xcc_contains('[id*=cookie] a, [class*=cookie] a, [id*=cookie] button, [class*=cookie] button', '^(Alle akzeptieren|Akzeptieren|Verstanden|Zustimmen|Okay|OK)$');
        if (_xcc != null && _xcc.length != 0) { _xcc[0].click(); }
    });

    const acceptButtons = await page.$x("//button[contains(text(),'Akzeptieren') or contains(text(),'OK')]");
    for (let button of acceptButtons) {
      await button.click();
      await page.waitForTimeout(1000); // Warten auf das Schließen des Banners
    }
  
    // Löschen des Cookie-Banners (optional)
    const cookieBanner = await page.$('.cookie-banner');
    if (cookieBanner) {
      await cookieBanner.evaluate((banner) => banner.remove());
    }

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 90 });
    await browser.close();

    res.set('Content-Type', 'image/jpeg');
    res.send(screenshot);
});

app.set_error_handler((req, res, error) => {
    console.log(error);
    if (error.message === "No Token Provided" || error.message === "Invalid Token Provided") {
        res.status(401);
        res.send(error.message)
    } else {
        res.status(500);
        res.send(error.message)
    }
});

(async () => {
    try {
        messages = await GetMessages(parseInt(process.env.MAX_HISTORY_MESSAGES, 10));
        console.log(`Loaded ${messages.length} messages from the database`);

        blocker = await PuppeteerBlocker.fromLists(fetch, [
            'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt'
        ]);
        console.log('Loaded adblocker & cookieblocker');

        app.listen(port)
            .then((socket) => console.log(`Listening on port: ${port}`))
            .catch((error) => console.log(`Failed to start webserver on: ${port}\nError: ${error}`));
    } catch (err) {
        console.log(err);
    }
})();