# Kantek_EuleLive
 WS Based nodejs backend to show all messages found by kantek

# Functionality
- [x] Show all messages found by kantek
- [x] Generate webpreview for links
- [x] Cache webpreview images
- [x] Master / Slave mode to render webpreview images on a different server

# Setup
1. Install nodejs 18.0.0 or higher
2. Install packages with `npm install`
3. Copy `.env.example` to `.env` and fill in the values
4. Run the bot with `node index.js`

# URL Parameters
- enableScreenshots=true - Generate webpage screenshots for found URLs  
- showNewMessagesAfterMs=100 - Delay the time a new message is delayed, helpfull to give the screenshot time to be generaded  
- fetchHistoryScreenshots=true - Request screenshots for historical messages (Might be very stressfull for your server)
- MaxTotalMessages=2000 - Limit the amount of messages displayed and stored.
