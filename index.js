require('dotenv').config();
const HyperExpress = require('hyper-express');
const Joi = require('joi');
const fs = require('fs');
const pg = require('pg');
const path = require('path');

const app = new HyperExpress.Server();
const port = process.env.PORT || 5000;
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
        pool.query(`SELECT text, user_id AS user, found_by FROM messages LIMIT ${limit}`, (err, result) => {
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
    ws.subscribe(`/new_message`);
    ws.on('close', () => console.log('Connection closed'));
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
    messages = await GetMessages(100);
    console.log(`Loaded ${messages.length} messages from the database`);

    app.listen(port)
        .then((socket) => console.log(`Listening on port: ${port}`))
        .catch((error) => console.log(`Failed to start webserver on: ${port}\nError: ${error}`));
})();