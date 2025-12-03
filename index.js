const { Telegraf, Markup, session } = require('telegraf');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

function formatPeriod(period) {
  return period ? period.toString().slice(-5) : period;
}

const logging = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  warning: (msg) => console.log(`[WARN] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

const BOT_TOKEN = "8418073029:AAHp2OTZf4zDJpeWOdvi8o8u7hmCoAeoY7E";
const PLATFORMS = {
  "6LOTTERY": "https://6lotteryapi.com/api/webapi/",
  "777BIGWIN": "https://api.bigwinqaz.com/api/webapi/",
  "CKLOTTERY": "https://ckygjf6r.com/api/webapi/"
};
const DEFAULT_BASE_URL = PLATFORMS["777BIGWIN"];
const SCHEDULE_CHECK_INTERVAL_MS = 30000; 

let sessions = {}; 
let savedUsers = []; 

function getSession(ctxOrUserId) {
    const userId = typeof ctxOrUserId === 'object' ? ctxOrUserId.from.id : ctxOrUserId;
    if (!sessions[userId]) {
        sessions[userId] = {
            id: userId,
            isLoggedIn: false,
            platform: DEFAULT_BASE_URL,
            username: '',
            token: '',
            betAmount: 0,
            betType: '',
            lastBetPeriodId: null,
            scheduleInterval: null,
            isScheduleRunning: false,
            account: '',
            password: '',
        };
    }
    return sessions[userId];
}

async function autoLoginUser(userId) {
    const session = getSession(userId); 
    
    if (!session || !session.account || !session.password) {
        logging.error(`Cannot auto-login user ${userId}: Credentials not found in session.`);
        return false;
    }

    try {
        const loginUrl = session.platform + 'Login';
        const loginData = {
            "phonetype": 1,
            "language": 7,
            "logintype": "mobile",
            "random": "8683c3053d2149f989eea0feecfbefcc",
            "username": "95" + session.account,
            "pwd": session.password
        };
        
        loginData.signature = signMd5Original(loginData).toUpperCase();
        loginData.timestamp = Math.floor(Date.now() / 1000);
        
        const response = await makeRequest(loginUrl, {
            method: 'POST',
            body: loginData
        });

        const result = response.data;

        if (result && result.code === 0 && result.data && result.data.token) {
            session.token = result.data.token;
            session.isLoggedIn = true;
            logging.info(`User ${userId} successfully re-logged in.`);
            return true;
        } else {
            logging.error(`Login API failed for user ${userId}. Response: ${JSON.stringify(result)}`);
            session.isLoggedIn = false;
            return false;
        }
    } catch (error) {
        logging.error(`Error during auto-login for user ${userId}: ${error.message}`);
        session.isLoggedIn = false;
        return false;
    }
}

async function enhancedPostRequest(session, endpoint, data, userId) {
    const url = session.platform + endpoint;
    
    const executeRequest = async (currentToken) => {
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; Mobile Build/QP1A.190711.020)',
                'Connection': 'Keep-Alive',
                'Authorization': currentToken ? `Bearer ${currentToken}` : '',
            },
            body: data
        };

        const agent = new https.Agent({ rejectUnauthorized: false });
        const req = https.request(url, { ...options, agent });
        
        return new Promise((resolve, reject) => {
            let responseData = '';
            
            req.on('response', (res) => {
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(responseData);
                        resolve({ status: res.statusCode, data: jsonData });
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
            
            if (data) {
                req.write(JSON.stringify(data));
            }
            
            req.end();
        });
    };

    try {
        let result = await executeRequest(session.token);

        const isUnauthorized = result.status === 401 || 
                              (result.data && (result.data.code === 1004 || 
                               (result.data.msg && result.data.msg.includes("Login failure"))));

        if (isUnauthorized) {
            logging.warning(`User ${userId} - API call to ${endpoint} returned Unauthorized. Attempting Auto-Login...`);
            
            const loginSuccess = await autoLoginUser(userId); 
            
            if (loginSuccess) {
                logging.info(`User ${userId} - Auto-Login successful. Retrying original request to ${endpoint}.`);
                result = await executeRequest(session.token);
                return result.data;
            } else {
                logging.error(`User ${userId} - Auto-Login failed. Cannot proceed with API call.`);
                session.isLoggedIn = false;
                return { code: -1, msg: "Auto-Login failed. Please login again." };
            }
        }
        
        return result.data;
    } catch (error) {
        logging.error(`Request failed for user ${userId}: ${error.message}`);
        return { code: -1, msg: error.message };
    }
}

async function _internalScheduleCheckLogic(bot) {
    try {
        const now = getMyanmarTime(); 
        const currentTotalMinutes = timeToMinutes(formatTime(now));
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTimeStr = `${currentHours.toString().padStart(2, '0')}:${currentMinutes.toString().padStart(2, '0')}`;
        
        for (const userId of Object.keys(userSettings)) {

        }

        for (const userId in sessions) {
            const session = sessions[userId];
            if (session.isScheduleRunning && session.isLoggedIn && session.token) {
                
                const periodId = await getCurrentPeriodId(session.platform);
                
                if (session.lastBetPeriodId === periodId) {
                    logging.debug(`User ${userId} - Skipping duplicate bet for Period ${formatPeriod(periodId)}.`);
                    continue;
                }

                logging.info(`User ${userId} is betting ${session.betAmount} on ${session.betType} for Period ${formatPeriod(periodId)}.`);
                
                const betData = {
                    "typeId": 13,
                    "issuenumber": periodId,
                    "language": 7,
                    "gameType": 2,
                    "amount": session.betAmount,
                    "betCount": 1,
                    "selectType": session.betType === 'B' ? 13 : 14,
                    "random": "b559fbe5f9c8402190a1d2d8de97ce50"
                };
                
                betData.signature = signMd5Original(betData).toUpperCase();
                betData.timestamp = Math.floor(Date.now() / 1000);

                const betResponse = await enhancedPostRequest(session, "GameTrxBetting", betData, userId);
                
                if (betResponse && betResponse.code === 0) {
                    logging.info(`User ${userId} - Bet SUCCESS for Period ${formatPeriod(periodId)}.`);
                    
                    session.lastBetPeriodId = periodId; 

                    await bot.telegram.sendMessage(userId, `✅ Bet Placed Success! Period: ${formatPeriod(periodId)}, Amount: ${session.betAmount}, Type: ${session.betType}`);
                } else {
                    logging.error(`User ${userId} - Bet FAILED for Period ${formatPeriod(periodId)}. Response: ${JSON.stringify(betResponse)}`);
                }
            }
        }
    } catch (error) {
        logging.error(`Error in schedule check logic: ${error.message}`);
    }
}

async function getCurrentPeriodId(platform) {
    try {
        const body = {
            "typeId": 13,
            "language": 7,
            "random": "b559fbe5f9c8402190a1d2d8de97ce50"
        };
        body.signature = signMd5(body).toUpperCase();
        body.timestamp = Math.floor(Date.now() / 1000);
        
        const response = await makeRequest(platform + "GetTrxGameIssue", {
            method: 'POST',
            body: body
        });
        
        if (response.data && response.data.code === 0 && response.data.data) {
            return response.data.data.predraw?.issueNumber || "12345";
        }
    } catch (error) {
        logging.error(`Error getting current period: ${error.message}`);
    }
    return "12345";
}

async function scheduleChecker(bot) {
    logging.info('Starting enhanced schedule checker with auto-start...');
    
    const checkSchedule = async () => {
        try {
            const now = getMyanmarTime();
            const currentTimeStr = formatTime(now);
            const currentTotalMinutes = timeToMinutes(currentTimeStr);
            
            logging.debug(`Schedule Check - Myanmar Time: ${currentTimeStr}, Total Minutes: ${currentTotalMinutes}`);
            
            for (const userId in userSettings) {
                const settings = userSettings[userId];
               
                if (!settings.schedule_enabled) {
                    continue;
                }
                
                const startTimes = settings.schedule_start_times || [];
                const stopTimes = settings.schedule_stop_times || [];
                
                if (startTimes.length === 0 || stopTimes.length === 0) {
                    continue;
                }
                
                let isInAnyWindow = false;
                let currentWindowIndex = -1;
         
                for (let i = 0; i < Math.min(startTimes.length, stopTimes.length); i++) {
                    const startMins = timeToMinutes(startTimes[i]);
                    const stopMins = timeToMinutes(stopTimes[i]);
                    
                    let inThisWindow = false;
                    
                    if (startMins < stopMins) {
                    
                        inThisWindow = (currentTotalMinutes >= startMins && currentTotalMinutes < stopMins);
                    } else {
                  
                        inThisWindow = (currentTotalMinutes >= startMins || currentTotalMinutes < stopMins);
                    }
                    
                    if (inThisWindow) {
                        isInAnyWindow = true;
                        currentWindowIndex = i;
                        logging.debug(`User ${userId} is in schedule window ${i+1}: ${startTimes[i]} - ${stopTimes[i]}`);
                        break;
                    }
                }
                
                const shouldOverrideProfitStop = settings.profit_stop_active;
                const startMinsArray = startTimes.map(timeToMinutes);
                const isStartMinute = startMinsArray.includes(currentTotalMinutes);
       
                if (isInAnyWindow && !settings.running) {
                    if (shouldOverrideProfitStop && !isStartMinute) {
                        logging.info(`User ${userId} - 💰 Profit Target Met. Bot STOPPED, waiting for the NEXT Start Time.`);
                        continue; 
                    }
                    
                    if (shouldOverrideProfitStop) {
                        logging.info(`User ${userId} - Overriding profit stop due to schedule start time.`);
                        settings.profit_stop_active = false; 
                    }
                    
                    logging.info(`User ${userId} - Schedule start time reached. Auto-starting bot.`);
            
                    settings.martin_index = 0;
                    settings.dalembert_units = 1;
                    settings.custom_index = 0;
                    settings.consecutive_losses = 0;
      
                    const entryLayer = settings.layer_limit || 1;
                    if (entryLayer === 2) {
                        settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0, required_loses: 1, real_betting_started: false };
                    } else if (entryLayer === 3) {
                        settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0, required_loses: 2, real_betting_started: false };
                    } else if (entryLayer >= 4 && entryLayer <= 9) {
                        settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0, required_loses: entryLayer - 1, real_betting_started: false };
                    }
             
                    delete userWaitingForResult[userId];
                    delete userShouldSkipNext[userId];
                    delete userSLSkipWaitingForWin[userId];
                    delete userDelayUntil[userId];
                    delete userPendingBets[userId];
                    delete userSkippedBets[userId];
                    
                    settings.running = true;
                    settings.manual_start_with_schedule = true;
             
                    bettingWorker(userId, { 
                        reply: (msg) => bot.telegram.sendMessage(userId, msg),
                        telegram: bot.telegram 
                    }, bot);
                    
                    try {
                        let startMessage = `⏰ AUTO-START\n🏇 Bot Is Now Running Automatically.`;
                        
                        if (shouldOverrideProfitStop) {
                            startMessage += ``;
                        }
                        
                        await bot.telegram.sendMessage(userId, startMessage, makeMainKeyboard(true));
                    } catch (error) {
                        logging.error(`Failed to send auto-start message to ${userId}: ${error.message}`);
                    }
                }
           
                if (!isInAnyWindow && settings.running) {
                    logging.info(`User ${userId} - Schedule stop time reached. Stopping bot.`);
                    
                    settings.running = false;
                    settings.manual_start_with_schedule = false;
              
                    delete userWaitingForResult[userId];
                    delete userShouldSkipNext[userId];
                    delete userSLSkipWaitingForWin[userId];
                    delete userDelayUntil[userId];
            
                    let totalProfit = 0;
                    let balanceText = "";
                    
                    if (settings.virtual_mode) {
                        totalProfit = (userStats[userId]?.virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
                        balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || VIRTUAL_BALANCE).toFixed(2)} Ks\n`;
                    } else {
                        totalProfit = userStats[userId]?.profit || 0;
                        try {
                            const session = userSessions[userId];
                            const finalBalance = await getBalance(session, userId);
                            balanceText = `💰 Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
                        } catch (error) {
                            balanceText = "Final Balance: Unknown\n";
                        }
                    }
                    
                    let profitIndicator = totalProfit > 0 ? "+" : (totalProfit < 0 ? "-" : "");
                    
                    const message = `⏰ SCHEDULE STOP\n${balanceText}💰 Total Profit: ${profitIndicator}${Math.abs(totalProfit).toFixed(2)} Ks\n\nStop time reached according to your schedule settings.`;
                    
                    try {
                        await bot.telegram.sendMessage(userId, message, makeMainKeyboard(true));
                    } catch (error) {
                        logging.error(`Failed to send schedule stop message to ${userId}: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            logging.error(`Error in schedule checker: ${error.message}`);
        }
    };
    
    checkSchedule();
    setInterval(checkSchedule, SCHEDULE_CHECK_INTERVAL_MS);
}

const WIN_LOSE_CHECK_INTERVAL = 2;
const MAX_RESULT_WAIT_TIME = 60;
const ADMIN_ID = 6867481050;
const MAX_BALANCE_RETRIES = 10;
const BALANCE_RETRY_DELAY = 5;
const BALANCE_API_TIMEOUT = 20000;
const BET_API_TIMEOUT = 30000;
const MAX_BET_RETRIES = 3;
const BET_RETRY_DELAY = 5;
const MAX_CONSECUTIVE_ERRORS = 5;
const MESSAGE_RATE_LIMIT_SECONDS = 10;
const MAX_TELEGRAM_RETRIES = 3;
const TELEGRAM_RETRY_DELAY = 2000;
const DEFAULT_BS_ORDER = "BSBBSBSSSB";
const VIRTUAL_BALANCE = 1000000;
const CHANNEL_SIGNAL_EXPIRY_TIME = 180000; 
const DELAY_AFTER_RESULT = 12000;
const MYANMAR_TIME_OFFSET = 6.5 * 60 * 60 * 1000;
let channelSignals = {}; 
let savedChannels = []; 

function loadSavedChannels() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'saved_channels.json');
    if (fs.existsSync(filePath)) {
      savedChannels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      logging.info(`Loaded ${savedChannels.length} saved channels.`);
    }
  } catch (error) {
    logging.error(`Error loading saved channels: ${error.message}`);
  }
}

function saveSavedChannels() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'saved_channels.json');
    fs.writeFileSync(filePath, JSON.stringify(savedChannels, null, 4));
  } catch (error) {
    logging.error(`Error saving channels: ${error.message}`);
  }
}

const channelSources = new Map(); 

const CHATGPT_PATTERNS = {
  "BBBS": "S",
  "SBBB": "B",
  "SSBB": "S",
  "BBSS": "S",
  "BSSS": "B",
  "SSSB": "S",
  "BSBB": "B",
  "SBSS": "B",
  "SSBS": "B",
  "BBSB": "S",
  "SBBS": "S",
  "BSSB": "B",
  "BSBS": "S",
  "SBSB": "B"
};

const COLORS = {
  GREEN: { name: 'Green', id: 11, numbers: [1, 3, 7, 9] },
  VIOLET: { name: 'Violet', id: 12, numbers: [0, 5] },
  RED: { name: 'Red', id: 10, numbers: [2, 4, 6, 8] }
};

const GAME_TYPES = {
  TRX: { typeId: 13, language: 7, endpoint: "GetTrxGameIssue", betEndpoint: "GameTrxBetting", random: "b559fbe5f9c8402190a1d2d8de97ce50" },
  WINGO30S: { typeId: 30, language: 7, endpoint: "GetGameIssue", betEndpoint: "GameBetting", random: "616fb37000504db2beab210b50c74498" }
};

const COLOR_MAPPING = {
  "0": "V",
  "1": "G",
  "2": "R",
  "3": "G",
  "4": "R",
  "5": "V",
  "6": "R",
  "7": "G",
  "8": "R",
  "9": "G"
};

const userState = {};
const userTemp = {};
const userSessions = {};
const userSettings = {};
const userPendingBets = {};
const userWaitingForResult = {};
const userStats = {};
const userGameInfo = {};
const userSkippedBets = {};
const userShouldSkipNext = {};
const userBalanceWarnings = {};
const userSkipResultWait = {};
const userStopInitiated = {};
const userSLSkipWaitingForWin = {};
const userResultHistory = {};
const userCommandLocks = {};
const userLastNumbers = [];
const userAllResults = {};
const userSessionExpiry = {};
const userPeriodCounters = {};
const userLoginCredentials = {};
const userDelayUntil = {}; 

let allowed777bigwinIds = new Set([
  286994, 929793, 816396, 540349
]);

let allUsers = new Set();

function loadUserCredentials() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'user_credentials.json');
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      Object.assign(userLoginCredentials, data);
      logging.info(`Loaded credentials for ${Object.keys(data).length} users`);
    }
  } catch (error) {
    logging.error(`Error loading credentials: ${error.message}`);
  }
}

function saveUserCredentials() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'user_credentials.json');
    
    fs.writeFileSync(filePath, JSON.stringify(userLoginCredentials, null, 4));
    logging.info(`Saved credentials for ${Object.keys(userLoginCredentials).length} users`);
  } catch (error) {
    logging.error(`Error saving credentials: ${error.message}`);
  }
}

async function restoreSessions() {
  logging.info("♻️ Restoring sessions for saved users...");
  const userIds = Object.keys(userLoginCredentials);
  
  for (const userId of userIds) {
    const creds = userLoginCredentials[userId];
    if (creds && creds.phone && creds.password) {
      try {
        const apiUrl = creds.apiUrl || DEFAULT_BASE_URL;
        logging.info(`Auto-logging in user ${userId} to ${apiUrl}...`);
        
        const { response: res, session } = await loginRequest(creds.phone, creds.password, apiUrl);
        
        if (session) {
            userSessions[userId] = session;
            userSessionExpiry[userId] = Date.now() + (6 * 60 * 60 * 1000);
            
            const userInfo = await getUserInfo(session, userId);
            if (userInfo) {
                userGameInfo[userId] = userInfo;
                logging.info(`✅ Auto-login successful for user ${userId}`);
            }
        } else {
            logging.warning(`❌ Auto-login failed for user ${userId}: ${res.msg}`);
        }
      } catch (error) {
        logging.error(`Error during auto-login for ${userId}: ${error.message}`);
      }
   
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  logging.info("♻️ Session restoration complete.");
}

async function autoLoginUserForMainBot(userId) {
  const credentials = userLoginCredentials[userId];
  
  if (!credentials || !credentials.phone || !credentials.password) {
    logging.error(`Cannot auto-login user ${userId}: Credentials not found.`);
    return false;
  }

  const apiUrl = credentials.apiUrl || DEFAULT_BASE_URL;

  try {
    logging.info(`Attempting auto-login for user ${userId} on ${apiUrl}`);
    const { response: res, session } = await loginRequest(credentials.phone, credentials.password, apiUrl);

    if (session) {
      userSessions[userId] = session;
      userSessionExpiry[userId] = Date.now() + (6 * 60 * 60 * 1000);

      const userInfo = await getUserInfo(session, userId);
      if (userInfo) {
        userGameInfo[userId] = userInfo;
        logging.info(`Auto-login successful for user ${userId}, new balance: ${userInfo.balance}`);
      
        if (!userStats[userId]) {
          userStats[userId] = { start_balance: parseFloat(userInfo.balance || 0), profit: 0.0 };
        } else {
          userStats[userId].start_balance = parseFloat(userInfo.balance || 0);
        }
        
        return true;
      }
    } else {
      logging.error(`Auto-login failed for user ${userId}: ${res.msg || res.error || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logging.error(`Error during auto-login for user ${userId}: ${error.message}`);
    return false;
  }
  
  return false;
}
async function ensureValidSession(userId) {
  if (!userSessions[userId]) {
    logging.info(`No session found for user ${userId}, attempting auto-login...`);
    const autoLoggedIn = await autoLoginUserForMainBot(userId);
    return autoLoggedIn;
  }
  
  const expiryTime = userSessionExpiry[userId] || 0;
  const now = Date.now();
 
  if (now > expiryTime || (expiryTime - now) < (5 * 60 * 1000)) {
    logging.info(`Session for user ${userId} needs refresh, attempting auto-login...`);
    const refreshed = await autoLoginUserForMainBot(userId);
    if (!refreshed) {
      logging.error(`Failed to refresh session for user ${userId}`);
      return false;
    }
  }
  
  return true;
}

function parseChannelSignal(text, sourceChannel = null) {
  try {
    const normalizedText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    
    const patterns = [
      /⏰\s*Period:\s*(\d+).*?Prediction:\s*(BIG|SMALL|B|S)/is, 
      /(?:Period|PERIOD|🆔|ID)\s*[:：]?\s*(\d+).*?(?:Prediction|PREDICTION|🎲|PREDICT)\s*[:：]?\s*(BIG|SMALL|B|S)/i,
      /(\d{5,})\s*[-–—]\s*(BIG|SMALL|B|S)/i,
      /(BIG|SMALL|B|S)\s+(?:for|FOR|အတွက်)\s+(\d{5,})/i,
      /🆔\s*(\d{5,}).*?🎲\s*(BIG|SMALL|B|S)/i,
      /(\d{5,})\s*.*?(BIG|SMALL|B|S)/i,
      /(BIG|SMALL|B|S)\s*.*?(\d{5,})/i,
      /(\d{5,})\s*.*?(ကြီး|ငယ်|BIG|SMALL)/i,
      /(\d{5,})\s*.*?(🔵🔵🔵|🔴🔴🔴|🟦🟦🟦|🟥🟥🟥)/i,
      /[#@*]\s*(\d{5,})\s*[#@*]\s*(BIG|SMALL|B|S)/i
    ];

    let confidence = 0;
    
    for (const pattern of patterns) {
      const match = normalizedText.match(pattern);
      if (match) {
        let period, prediction;
       
        const isReversedPattern = pattern.toString().includes('(BIG|SMALL|B|S).*?(\\d{5,})') || 
                                  pattern.toString().includes('(ကြီး|ငယ်|BIG|SMALL).*?(\\d{5,})');
        
        if (isReversedPattern) {
          prediction = match[1].toUpperCase();
          period = match[2];
        } else {
          period = match[1];
          prediction = match[2].toUpperCase();
        }

        if (prediction === "ကြီး") prediction = "BIG";
        if (prediction === "ငယ်") prediction = "SMALL";
        
        if (prediction === "🔵🔵🔵" || prediction === "🟦🟦🟦") prediction = "BIG";
        if (prediction === "🔴🔴🔴" || prediction === "🟥🟥🟥") prediction = "SMALL";
        
        if (prediction === "BIG") prediction = "B";
        if (prediction === "SMALL") prediction = "S";
        
        if (sourceChannel && channelSources.has(sourceChannel)) {
          confidence = channelSources.get(sourceChannel).reliability || 70;
        } else {
          if (pattern.toString().includes('⏰')) { 
             confidence = 90; 
          } else {
             confidence = pattern.toString().includes('Period') ? 80 : 
                          pattern.toString().includes('🆔') ? 75 : 
                          pattern.toString().includes('🎲') ? 75 : 60;
          }
        }

        if (period && prediction && (prediction === 'B' || prediction === 'S')) {
          const periodShort = period.slice(-5);
          
          return {
            period: periodShort,
            fullPeriod: period, 
            prediction: prediction,
            receivedAt: Date.now(),
            valid: true,
            confidence: confidence,
            source: sourceChannel
          };
        }
      }
    }
    
    return { valid: false };
  } catch (error) {
    logging.error(`Error parsing channel signal: ${error.message}`);
    return { valid: false };
  }
}

async function channelPostHandler(ctx) {
  try {
    const message = ctx.channelPost || ctx.message;
    if (!message || !message.text) return;

    const rawText = message.text;
    const sourceChannelId = ctx.chat ? ctx.chat.id.toString() : null; 
    
    logging.info(`Received message from channel ID: ${sourceChannelId}`);
    
    const isTrackedChannel = savedChannels.find(ch => ch.id.toString() === sourceChannelId);
    
    if (isTrackedChannel) {
      const signal = parseChannelSignal(rawText, sourceChannelId);
      
      if (signal.valid) {
        channelSignals[sourceChannelId] = {
          ...signal,
          name: isTrackedChannel.name, 
          confidence: isTrackedChannel.reliability
        };
        
        logging.info(`✅ Signal Received from ${isTrackedChannel.name}: Full Period: ${signal.fullPeriod}, Short: ${signal.period} -> ${signal.prediction}`);
      } else {
        logging.warning(`Failed to parse signal from ${isTrackedChannel.name} (ID: ${sourceChannelId}): ${rawText.substring(0, 50)}...`);
      }
    } else {
      logging.info(`Channel ${sourceChannelId} is not in tracked channels list.`);
    }
  } catch (error) {
    logging.error(`Error in channel post handler: ${error.message}`);
  }
}

async function getSpecificChannelPrediction(channelId, currentIssue) {
  try {
    logging.info(`Getting prediction for channel ${channelId}, current issue: ${currentIssue}`);
    
    const signal = channelSignals[channelId]; 
    
    if (!signal) {
      logging.info(`No signal found for channel ${channelId}. Skipping.`);
      return { 
        result: Math.random() < 0.5 ? 'B' : 'S', 
        shouldSkip: true,
        skipReason: "📡 Waiting for Signal...",
        signalInfo: null
      };
    }

    const currentPeriodShort = formatPeriod(currentIssue);
    const signalAge = Date.now() - signal.receivedAt;
    
    logging.info(`Comparing periods - Signal: ${signal.period} (Full: ${signal.fullPeriod}), Current: ${currentPeriodShort}, Age: ${Math.floor(signalAge / 1000)}s`);
    
    let isMatch = false;
    
    if (signal.period === currentPeriodShort) {
      isMatch = true;
      logging.info(`Direct period match found: ${signal.period} === ${currentPeriodShort}`);
    }
    else if (parseInt(signal.period) === parseInt(currentPeriodShort) + 1) {
      isMatch = true;
      logging.info(`Signal period matches next period: ${parseInt(signal.period)} === ${parseInt(currentPeriodShort) + 1}`);
    }
    else if (signal.fullPeriod && signal.fullPeriod.slice(-5) === currentPeriodShort) {
      isMatch = true;
      logging.info(`Full period match found: ${signal.fullPeriod.slice(-5)} === ${currentPeriodShort}`);
    }
    else if (signal.fullPeriod && parseInt(signal.fullPeriod.slice(-5)) === parseInt(currentPeriodShort) + 1) {
      isMatch = true;
      logging.info(`Full period matches next period: ${parseInt(signal.fullPeriod.slice(-5))} === ${parseInt(currentPeriodShort) + 1}`);
    }

    if (signalAge > CHANNEL_SIGNAL_EXPIRY_TIME) {
      logging.info(`Signal expired: age ${Math.floor(signalAge / 1000)}s > ${Math.floor(CHANNEL_SIGNAL_EXPIRY_TIME / 1000)}s`);
      return { 
        result: Math.random() < 0.5 ? 'B' : 'S', 
        shouldSkip: true,
        skipReason: "📡 Signal Expired",
        signalInfo: null
      };
    }

    if (!isMatch) {
      logging.info(`Period mismatch: signal ${signal.period} vs current ${currentPeriodShort}. Skipping.`);
      return { 
        result: Math.random() < 0.5 ? 'B' : 'S', 
        shouldSkip: true,
        skipReason: "📡 Period Not Match",
        signalInfo: null
      };
    }

    logging.info(`Using signal prediction: ${signal.prediction}`);
    return { 
      result: signal.prediction, 
      shouldSkip: false,
      skipReason: null,
      signalInfo: `Source: ${signal.name}`
    };
    
  } catch (error) {
    logging.error(`Error in getSpecificChannelPrediction: ${error.message}`);
    return { result: 'S', shouldSkip: true, skipReason: "Error" };
  }
}

function shouldSkipPeriod(userId, strategy) {
  return false;
}

function resetSkipPeriods(userId) {
  delete userPeriodCounters[userId];
}

function getSkipMessage(userId, ch, strategy, gameType, currentIssue, periodCount) {
  const gameDisplay = getGameTypeDisplayName(gameType);
  return `🆔 ${gameDisplay}: ${formatPeriod(currentIssue)}\n🎲 Order: Waiting For ${periodCount}/4\n🚨 Value: ${strategy}`;
}

function getSkipResultMessage(userId, currentIssue, bigSmall, number, color, gameType, currentSkip, totalSkips) {
  const gameDisplay = getGameTypeDisplayName(gameType);
  return `🔴 Skip ${currentSkip}/${totalSkips}\n🆔 ${gameDisplay}: ${formatPeriod(currentIssue)} => ${bigSmall}•${number}`;
}

function checkPatternInHistory(history, pattern) {
  if (!history || history.length < pattern.length) {
    return false;
  }
  
  const historyStr = history.slice(-pattern.length).join('');
  return historyStr === pattern;
}

function checkConsecutiveSameResults(history) {
  if (!history || history.length < 2) {
    return false;
  }
  
  const lastTwo = history.slice(-2).join('');
  return lastTwo === 'BB' || lastTwo === 'SS';
}

async function getChatGPTPrediction(userId) {
  try {
    const session = userSessions[userId];
    const gameHistory = await getGameHistory(session);
    
    if (!gameHistory || gameHistory.length < 4) {
      logging.error(`Chat GPT Strategy: Not enough history data (need at least 4 results)`);
      return { result: Math.random() < 0.5 ? 'B' : 'S', percent: '50.0', shouldSkip: false };
    }
    
    const last4Results = gameHistory.slice(0, 4).map(item => {
      const number = parseInt(item.number) % 10;
      return number >= 5 ? 'B' : 'S';
    });
    
    const pattern = last4Results.join('');
    logging.info(`Chat GPT Strategy: Last 4 results pattern: ${pattern}`);
    
    if (CHATGPT_PATTERNS[pattern]) {
      const prediction = CHATGPT_PATTERNS[pattern];
      logging.info(`Chat GPT Strategy: Pattern ${pattern} matches, prediction: ${prediction}`);
      return { result: prediction, percent: 'N/A', shouldSkip: false };
    } else {
      logging.info(`Chat GPT Strategy: Pattern ${pattern} not found in defined patterns, skipping`);
      return { result: Math.random() < 0.5 ? 'B' : 'S', percent: 'N/A', shouldSkip: true };
    }
  } catch (error) {
    logging.error(`Error getting Chat GPT prediction: ${error.message}`);
    return { result: Math.random() < 0.5 ? 'B' : 'S', percent: '50.0', shouldSkip: false };
  }
}

const ensureDataDir = () => {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
};

function loadUserSettings() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'user_settings.json');
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      Object.assign(userSettings, data);
      logging.info(`Loaded user settings for ${Object.keys(data).length} users`);
    } else {
      logging.warning("user_settings.json not found. Starting with empty settings");
      fs.writeFileSync(filePath, JSON.stringify({}, null, 4));
    }
  } catch (error) {
    logging.error(`Error loading user_settings.json: ${error.message}`);
  }
}

function saveUserSettings() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'user_settings.json');
    
    fs.writeFileSync(filePath, JSON.stringify(userSettings, null, 4));
    logging.info(`Saved user settings for ${Object.keys(userSettings).length} users`);
  } catch (error) {
    logging.error(`Error saving user settings: ${error.message}`);
  }
}

function updateUserSetting(userId, key, value) {
  if (!userSettings[userId]) {
    userSettings[userId] = getDefaultUserSettings();
  }
  userSettings[userId][key] = value;
  saveUserSettings();
}

function getDefaultUserSettings() {
  return {
    strategy: "CHANNEL_SIGNAL", 
    betting_strategy: "Martingale",
    game_type: "TRX",
    bet_type: "BS",
    martin_index: 0,
    dalembert_units: 1,
    pattern_index: 0,
    running: false,
    consecutive_losses: 0,
    current_layer: 0,
    skip_betting: false,
    sl_layer: null,
    original_martin_index: 0,
    original_dalembert_units: 1,
    original_custom_index: 0,
    custom_index: 0,
    layer_limit: 1,
    virtual_mode: false,
    bet_sizes: [100],
    bs_wait_count: 0,
    bs_wait_active: false,
    bs_wait_remaining: 0,
    fallback_on_expired_signal: true,
    min_signal_confidence: 60, 
    target_channel_id: null,
    schedule_enabled: false,
    schedule_start_times: [],
    schedule_stop_times: [],
    schedule_restart_time: null,
    manual_start_with_schedule: false,
    profit_stop_active: false,
    target_profit: null,
    stop_loss: null
  };
}

function loadAllowedUsers() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'users_6lottery.json');
    const permanentAllowedIds = new Set([
      286994, 929793, 816396, 540349
    ]);
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const fileIds = new Set(data.allowed_ids || []);
      allowed777bigwinIds = new Set([...permanentAllowedIds, ...fileIds]);
      if (fileIds.size !== allowed777bigwinIds.size) {
        saveAllowedUsers();
      }
      
      logging.info(`Loaded ${allowed777bigwinIds.size} users (${permanentAllowedIds.size} permanent + ${fileIds.size} from file)`);
    } else {
      logging.warning("users_6lottery.json not found. Using permanent allowed IDs only");
      allowed777bigwinIds = permanentAllowedIds;
      saveAllowedUsers();
    }
  } catch (error) {
    logging.error(`Error loading users_6lottery.json: ${error.message}`);
    const permanentAllowedIds = new Set([
      286994, 929793, 816396, 540349
    ]);
    allowed777bigwinIds = permanentAllowedIds;
  }
}

function saveAllowedUsers() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'users_6lottery.json');
    
    fs.writeFileSync(filePath, JSON.stringify({ 
      allowed_ids: Array.from(allowed777bigwinIds) 
    }, null, 4));
    logging.info(`Saved ${allowed777bigwinIds.size} users`);
  } catch (error) {
    logging.error(`Error saving user list: ${error.message}`);
  }
}

function loadAllUsers() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'all_users.json');
    
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return new Set(data.users || []);
    } else {
      logging.warning("all_users.json not found. Starting new");
      return new Set();
    }
  } catch (error) {
    logging.error(`Error loading all_users.json: ${error.message}`);
    return new Set();
  }
}

function saveAllUsers(allUsersSet) {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'all_users.json');
    
    fs.writeFileSync(filePath, JSON.stringify({ 
      users: Array.from(allUsersSet),
      last_updated: new Date().toISOString()
    }, null, 4));
    logging.info(`Saved ${allUsersSet.size} total users`);
  } catch (error) {
    logging.error(`Error saving all users list: ${error.message}`);
  }
}

function addUserToAllList(userId) {
  if (!allUsers.has(userId)) {
    allUsers.add(userId);
    saveAllUsers(allUsers);
    logging.info(`Added user ${userId} to all users list`);
  }
}

async function acquireCommandLock(userId) {
  if (userCommandLocks[userId]) {
    return false;
  }
  userCommandLocks[userId] = true;
  return true;
}

function releaseCommandLock(userId) {
  delete userCommandLocks[userId];
}

async function withCommandLock(userId, fn) {
  if (!await acquireCommandLock(userId)) {
    return { success: false, message: "🔄 Please wait, processing previous command..." };
  }
  
  try {
    const result = await fn();
    return { success: true, data: result };
  } catch (error) {
    logging.error(`Command execution error for user ${userId}: ${error.message}`);
    return { success: false, message: `❌ Error: ${error.message}` };
  } finally {
    releaseCommandLock(userId);
  }
}

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ 
      rejectUnauthorized: false,
      keepAlive: true,
      keepAliveMsecs: 1000
    });
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; Mobile Build/QP1A.190711.020)',
        'Connection': 'Keep-Alive'
      },
      timeout: 12000
    };
    
    const requestOptions = {
      ...defaultOptions,
      ...options,
      agent
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ data: jsonData });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

function normalizeText(text) {
  return text.normalize('NFKC').trim();
}

function signMd5(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "signature" && key !== "timestamp") {
      filtered[key] = value;
    }
  }
  const sorted = Object.keys(filtered).sort().reduce((acc, key) => {
    acc[key] = filtered[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function signMd5Original(data) {
  const dataCopy = { ...data };
  delete dataCopy.signature;
  delete dataCopy.timestamp;
  const sorted = Object.keys(dataCopy).sort().reduce((acc, key) => {
    acc[key] = dataCopy[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const amtStr = String(amt);
  const trailingZeros = amtStr.length - amtStr.replace(/0+$/, '').length;
  
  if (trailingZeros >= 4) return 10000;
  if (trailingZeros === 3) return 1000;
  if (trailingZeros === 2) return 100;
  if (trailingZeros === 1) return 10;
  return Math.pow(10, amtStr.length - 1);
}

function getSelectMap(betType) {
  if (betType === "COLOR") {
    return { "G": 11, "V": 12, "R": 10 };
  } else {
    return { "B": 13, "S": 14 };
  }
}

function numberToBS(num) {
  return num >= 5 ? 'B' : 'S';
}

function numberToColor(num) {
  if (COLORS.GREEN.numbers.includes(num)) return 'G';
  if (COLORS.VIOLET.numbers.includes(num)) return 'V';
  if (COLORS.RED.numbers.includes(num)) return 'R';
  return 'G';
}

function getColorName(colorCode) {
  switch(colorCode) {
    case 'G': return COLORS.GREEN.name;
    case 'V': return COLORS.VIOLET.name;
    case 'R': return COLORS.RED.name;
    default: return 'Unknown';
  }
}

function getGameTypeDisplayName(gameType) {
  switch(gameType) {
    case "TRX":
      return " 𝐓𝐑𝐗";
    case "WINGO30S":
      return "𝐖𝐈𝐍𝐆𝐎 𝟑𝟎𝐒";
    default:
      return gameType;
  }
}

function getPlatformDisplayName(apiUrl) {
  for (const [platform, url] of Object.entries(PLATFORMS)) {
    if (url === apiUrl) {
      switch(platform) {
        case "6LOTTERY":
          return "𝟔𝐋𝐎𝐓𝐓𝐄𝐑𝐘";
        case "777BIGWIN":
          return "𝟟𝟟𝟟 𝐁𝐈𝐆𝐖𝐈𝐍";
        case "CKLOTTERY":
          return "𝐂𝐤-𝐋𝐎𝐓𝐓𝐄𝐑𝐘";
        default:
          return "𝟔𝐋𝐎𝐓𝐓𝐄𝐑𝐘";
      }
    }
  }
  return "𝟔𝐋𝐎𝐓𝐓𝐄𝐑𝐘";
}

async function getWingoGameResults(session) {
  const body = {
    "pageSize": 10,
    "typeId": 30, 
    "language": 7,
    "random": "616fb37000504db2beab210b50c74498",
    "signature": "28EC22FF6CB095E3F04C3C5DD663BFA5",
    "timestamp": Math.floor(Date.now() / 1000)
  };
  
  try {
    const response = await session.post("GetNoaverageEmerdList", body);
    return response.data;
  } catch (error) {
    logging.error(`Error getting WINGO30S results: ${error.message}`);
    return { error: error.message };
  }
}

async function getGameIssueRequest(session, gameType = "TRX") {
  const gameConfig = GAME_TYPES[gameType] || GAME_TYPES.TRX;
  const body = {
    "typeId": gameConfig.typeId,
    "language": gameConfig.language,
    "random": gameConfig.random
  };
  body.signature = signMd5(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post(gameConfig.endpoint, body);
    logging.info(`${gameType} game issue request`);
    return response.data;
  } catch (error) {
    logging.error(`${gameType} game issue error: ${error.message}`);
    return { error: error.message };
  }
}

async function placeBetRequest(session, issueNumber, selectType, unitAmount, betCount, gameType, userId) {
  const gameConfig = GAME_TYPES[gameType] || GAME_TYPES.TRX;
  const settings = userSettings[userId] || {};
  const betType = settings.bet_type || "BS";
  const actualGameType = betType === "COLOR" ? 0 : 2;
  
  const betBody = {
    "typeId": gameConfig.typeId,
    "issuenumber": issueNumber,
    "language": gameConfig.language,
    "gameType": actualGameType,
    "amount": unitAmount,
    "betCount": betCount,
    "selectType": selectType,
    "random": gameConfig.random
  };
  betBody.signature = signMd5Original(betBody).toUpperCase();
  betBody.timestamp = Math.floor(Date.now() / 1000);
  
  for (let attempt = 0; attempt < MAX_BET_RETRIES; attempt++) {
    try {
      const response = await session.post(gameConfig.betEndpoint, betBody);
      const res = response.data;
      logging.info(`Bet request for user ${userId}, ${gameType}, issue ${issueNumber}, select_type ${selectType}, amount ${unitAmount * betCount}`);
      return res;
    } catch (error) {
      logging.error(`Bet error for user ${userId}, attempt ${attempt + 1}: ${error.message}`);
      
      if (attempt < MAX_BET_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BET_RETRY_DELAY * 1000));
        continue;
      }
      return { error: "Failed after retries" };
    }
  }
  return { error: "Failed after retries" };
}

async function loginRequest(phone, password, baseUrl = DEFAULT_BASE_URL) {
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const body = {
    "phonetype": 1,
    "language": 7,
    "logintype": "mobile",
    "random": "8683c3053d2149f989eea0feecfbefcc",
    "username": "95" + phone,
    "pwd": password
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await makeRequest(baseUrl + "Login", {
      method: 'POST',
      body: body
    });
    
    const res = response.data;
    if (res.code === 0 && res.data) {
      const tokenHeader = res.data.tokenHeader || "Bearer ";
      const token = res.data.token || "";
      
      const session = {
        post: async (endpoint, data) => {
          const url = baseUrl + endpoint;
          const options = {
            method: 'POST',
            headers: {
              "Authorization": `${tokenHeader}${token}`,
              "Content-Type": "application/json; charset=UTF-8",
              "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 10; Build/QP1A.190711.020)"
            },
            body: data
          };
          return makeRequest(url, options);
        }
      };
      return { response: res, session };
    }
    return { response: res, session: null };
  } catch (error) {
    logging.error(`Login error: ${error.message}`);
    return { response: { error: error.message }, session: null };
  }
}

async function getUserInfo(session, userId) {
  const body = {
    "language": 7,
    "random": "d713b04404a04d03964502718194fd0c"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetUserInfo", body);
    const res = response.data;
    if (res.code === 0 && res.data) {
      const info = {
        "user_id": res.data.userId,
        "username": res.data.userName,
        "nickname": res.data.nickName,
        "balance": res.data.amount,
        "photo": res.data.userPhoto,
        "login_date": res.data.userLoginDate,
        "withdraw_count": res.data.withdrawCount,
        "is_allow_withdraw": res.data.isAllowWithdraw === 1
      };
      userGameInfo[userId] = info;
      return info;
    }
    return null;
  } catch (error) {
    logging.error(`Get user info error: ${error.message}`);
    return null;
  }
}

async function getBalance(session, userId) {
  const body = {
    "language": 7,
    "random": "113627006f984ecb96675f8cf15827d1"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetBalance", body);
    const res = response.data;
    logging.info(`Balance check response for user ${userId}`);
    
    if (res.code === 0 && res.data) {
      const data = res.data;
      const amount = data.Amount || data.amount || data.balance;
      if (amount !== undefined && amount !== null) {
        const balance = parseFloat(amount);
        if (userGameInfo[userId]) {
          userGameInfo[userId].balance = balance;
        }
        if (!userStats[userId]) {
          userStats[userId] = { start_balance: balance, profit: 0.0 };
        }
        return balance;
      }
      logging.warning(`No balance amount found for user ${userId}`);
    } else {
      logging.warning(`Get balance API returned error for user ${userId}: ${res.msg || 'Unknown error'}`);
     
    }
    return null;
  } catch (error) {
    logging.error(`Balance check error for user ${userId}: ${error.message}`);
    return null;
  }
}

function getValidDalembertBetAmount(unitSize, currentUnits, balance, minBet) {
  let amount = unitSize * currentUnits;
  
  while (amount > balance && currentUnits > 1) {
    currentUnits--;
    amount = unitSize * currentUnits;
  }
  
  if (amount > balance) {
    amount = balance;
  }
  
  if (amount < minBet) {
    amount = minBet;
  }
  
  return { amount, adjustedUnits: currentUnits };
}

function computeBetDetails(desiredAmount) {
  if (desiredAmount <= 0) {
    return { unitAmount: 0, betCount: 0, actualAmount: 0 };
  }
  
  const unitAmount = computeUnitAmount(desiredAmount);
  const betCount = Math.max(1, Math.floor(desiredAmount / unitAmount));
  const actualAmount = unitAmount * betCount;
  
  return { unitAmount, betCount, actualAmount };
}

function calculateBetAmount(settings, currentBalance) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  const minBetSize = Math.min(...betSizes);
  
  logging.debug(`Calculating bet amount - Strategy: ${bettingStrategy}, Bet Sizes: [${betSizes.join(', ')}]`);
  
  if (bettingStrategy === "D'Alembert") {
    if (betSizes.length > 1) {
      throw new Error("D'Alembert strategy requires only ONE bet size");
    }
    
    const unitSize = betSizes[0];
    let units = settings.dalembert_units || 1;
    
    const { amount: validAmount, adjustedUnits } = getValidDalembertBetAmount(unitSize, units, currentBalance, minBetSize);
    
    if (adjustedUnits !== units) {
      settings.dalembert_units = adjustedUnits;
      units = adjustedUnits;
      logging.info(`D'Alembert: Adjusted units to ${units} due to balance constraints`);
    }
    
    logging.info(`D'Alembert: Betting ${validAmount} (${units} units of ${unitSize})`);
    return validAmount;
    
  } else if (bettingStrategy === "Custom") {
    const customIndex = settings.custom_index || 0;
    const adjustedIndex = Math.min(customIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`Custom: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
    
  } else {
    const martinIndex = settings.martin_index || 0;
    const adjustedIndex = Math.min(martinIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`${bettingStrategy}: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
  }
}

function updateBettingStrategy(settings, isWin, betAmount) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  
  logging.debug(`Updating betting strategy - Strategy: ${bettingStrategy}, Result: ${isWin ? 'WIN' : 'LOSS'}, Bet Amount: ${betAmount}`);
  
  if (isWin) {
    if (settings.consecutive_losses >= (settings.sl_layer || 0)) {
      settings.consecutive_losses = 0;
      logging.info(`Betting strategy: Win after SL Skip - Resetting consecutive losses to 0`);
    }
  }
  
  if (bettingStrategy === "Martingale") {
    if (isWin) {
      settings.martin_index = 0;
      logging.info("Martingale: Win - Reset to index 0");
    } else {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Martingale: Loss - Move to index ${settings.martin_index}`);
    }
    
  } else if (bettingStrategy === "Anti-Martingale") {
    if (isWin) {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Anti-Martingale: Win - Move to index ${settings.martin_index}`);
    } else {
      settings.martin_index = 0;
      logging.info("Anti-Martingale: Loss - Reset to index 0");
    }
    
  } else if (bettingStrategy === "D'Alembert") {
    if (isWin) {
      settings.dalembert_units = Math.max(1, (settings.dalembert_units || 1) - 1);
      logging.info(`D'Alembert: Win - Decrease units to ${settings.dalembert_units}`);
    } else {
      settings.dalembert_units = (settings.dalembert_units || 1) + 1;
      logging.info(`D'Alembert: Loss - Increase units to ${settings.dalembert_units}`);
    }
    
  } else if (bettingStrategy === "Custom") {
    const currentIndex = settings.custom_index || 0;
    
    let actualIndex = 0;
    for (let i = 0; i < betSizes.length; i++) {
      if (betSizes[i] === betAmount) {
        actualIndex = i;
        break;
      }
    }
    
    if (isWin) {
      if (actualIndex > 0) {
        settings.custom_index = actualIndex - 1;
      } else {
        settings.custom_index = 0;
      }
      logging.info(`Custom: Win - Move to index ${settings.custom_index}`);
    } else {
      if (actualIndex < betSizes.length - 1) {
        settings.custom_index = actualIndex + 1;
      } else {
        settings.custom_index = betSizes.length - 1;
      }
      logging.info(`Custom: Loss - Move to index ${settings.custom_index}`);
    }
  }
  
  saveUserSettings();
}

async function getGameHistory(session, gameType = "TRX") {
  const gameConfig = GAME_TYPES[gameType] || GAME_TYPES.TRX;
  const body = {
    "pageSize": 10,
    "typeId": gameConfig.typeId,
    "language": gameConfig.language,
    "random": "f15bdcc4e6a04f82828b2f7a7b4c6e5a"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetNoaverageEmerdList", body);
    const data = response.data?.list || [];
    logging.debug(`Game history response: ${data.length} records retrieved`);
    
    const validData = data.filter(item => item && item.number !== undefined && item.number !== null);
    logging.debug(`Game history valid records: ${validData.length} out of ${data.length}`);
    
    return validData;
  } catch (error) {
    logging.error(`Error fetching game history: ${error.message}`);
    return [];
  }
}

async function sendMessageWithRetry(ctx, text, replyMarkup = null) {
  for (let attempt = 0; attempt < MAX_TELEGRAM_RETRIES; attempt++) {
    try {
      if (replyMarkup) {
        await ctx.reply(text, replyMarkup);
      } else {
        await ctx.reply(text);
      }
      return true;
    } catch (error) {
      logging.error(`Telegram message error, attempt ${attempt + 1}: ${error.message}`);
      if (attempt < MAX_TELEGRAM_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, TELEGRAM_RETRY_DELAY));
        continue;
      }   
      return false;
    }
  }
  return false;
}

function resetSLSkipState(userId) {
  const settings = userSettings[userId] || {};
  
  settings.consecutive_losses = 0;
  userShouldSkipNext[userId] = false;
  delete userSLSkipWaitingForWin[userId];
  
  settings.martin_index = settings.original_martin_index || 0;
  settings.dalembert_units = settings.original_dalembert_units || 1;
  settings.custom_index = settings.original_custom_index || 0;
  
  logging.info(`SL Skip state completely reset for user ${userId}`);
  saveUserSettings();
}

function resetEntryLayer(userId) {
  const settings = userSettings[userId] || {};
  const entryLayer = settings.layer_limit || 1;
  
  if (entryLayer >= 2 && entryLayer <= 9) {
    if (entryLayer === 2) {
      settings.entry_layer_state = { 
        waiting_for_loses: true, 
        consecutive_loses: 0,
        required_loses: 1,
        real_betting_started: false
      };
    } else if (entryLayer === 3) {
      settings.entry_layer_state = { 
        waiting_for_loses: true, 
        consecutive_loses: 0,
        required_loses: 2,
        real_betting_started: false
      };
    } else if (entryLayer >= 4 && entryLayer <= 9) {
      settings.entry_layer_state = { 
        waiting_for_loses: true, 
        consecutive_loses: 0,
        required_loses: entryLayer - 1,
        real_betting_started: false
      };
    }
    logging.info(`Entry Layer ${entryLayer} completely reset for user ${userId}`);
  }
}

function getMyanmarTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const myanmarTime = new Date(utc + (3600000 * 6.5)); 
  return myanmarTime;
}

function formatTime(date) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeInput(timeStr) {
  const times = timeStr.split(/[,，\s]+/).filter(t => t.trim());
  const parsedTimes = [];
  
  for (const time of times) {
    const normalized = time.toLowerCase().replace(/\s/g, '');
    const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    
    if (!match) continue;
    
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3];
    
    if (period === 'pm' && hours < 12) hours += 12;
    else if (period === 'am' && hours === 12) hours = 0;
    
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) continue;
    
    parsedTimes.push({
      hours: hours.toString().padStart(2, '0'),
      minutes: minutes.toString().padStart(2, '0'),
      formatted: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    });
  }
  
  return parsedTimes.length > 0 ? parsedTimes : null;
}

function formatTimeForDisplay(time24) {
  if (!time24) return "Not set";
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return -1;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function resetScheduleSettings(userId) {
  const settings = userSettings[userId] || {};
  
  settings.schedule_enabled = false;
  settings.schedule_start_times = [];
  settings.schedule_stop_times = [];
  settings.schedule_restart_time = null;
  settings.manual_start_with_schedule = false;
  settings.profit_stop_active = false;
  
  saveUserSettings();
  logging.info(`Time Setting cleared for user ${userId} (Stop Loss)`);
}

async function checkProfitAndStopLoss(userId, bot) {
    const settings = userSettings[userId] || {};
    const targetProfit = settings.target_profit;
    const stopLoss = settings.stop_loss;
    
    if (!targetProfit && !stopLoss) {
        return false;
    }
    
    let currentProfit;
    let balanceText;
    
    if (settings.virtual_mode) {
        currentProfit = (userStats[userId].virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
        balanceText = `💰 Final Virtual Balance: ${userStats[userId].virtual_balance.toFixed(2)} Ks\n`;
    } else {
        currentProfit = userStats[userId].profit || 0;
        const session = userSessions[userId];
        const finalBalance = await getBalance(session, userId);
        balanceText = `💰 Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
    }
    
    let profitIndicator = "";
    if (currentProfit > 0) {
        profitIndicator = "+";
    } else if (currentProfit < 0) {
        profitIndicator = "-";
    }
    
    if (targetProfit && currentProfit >= targetProfit) {
        logging.info(`User ${userId} - Profit target reached: ${currentProfit} >= ${targetProfit}`);
        
        settings.running = false;
        settings.profit_stop_active = true; 
        
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
        
        const message = `🏆 𝐏𝐑𝐎𝐅𝐈𝐓 𝐓𝐀𝐑𝐆𝐄𝐓 𝐑𝐄𝐀𝐂𝐇𝐄𝐃! 🏆\n\n` +
                       `⛳ Target: ${targetProfit} Ks\n` +
                       `💼 Achieved: ${profitIndicator}${Math.abs(currentProfit).toFixed(2)} Ks\n` +
                       balanceText +
                       ``;
        
        try {
            await bot.telegram.sendMessage(userId, message, makeMainKeyboard(true));
        } catch (error) {
            logging.error(`Failed to send profit target message to ${userId}: ${error.message}`);
        }
        
        return true;
    }
    
    if (stopLoss && currentProfit <= -stopLoss) {
        settings.running = false;
        settings.manual_start_with_schedule = false;
        settings.profit_stop_active = false;
    
        resetScheduleSettings(userId);
        
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
        
        const message = `🚫 STOP LOSS LIMIT REACHED! 🚫\n\n` +
                       `🔺Stop Loss Limit: ${stopLoss} Ks\n` +
                       `♦Current Loss: ${Math.abs(currentProfit).toFixed(2)} Ks\n` +
                       balanceText +
                       `\n🛑 All time settings have been AUTO CLEARED.`;
        
        try {
            await bot.telegram.sendMessage(userId, message, makeMainKeyboard(true));
        } catch (error) {
            logging.error(`Failed to send stop loss message to ${userId}: ${error.message}`);
        }
        
        return true;
    }
    
    return false;
}

async function refreshSessionIfNeeded(userId) {
  const credentials = userLoginCredentials[userId];
  if (!credentials || !credentials.phone || !credentials.password) {
    logging.error(`No login credentials found for user ${userId}`);
    return false;
  }
  
  const apiUrl = credentials.apiUrl || DEFAULT_BASE_URL;

  try {
    logging.info(`Attempting to refresh session for user ${userId} on ${apiUrl}`);
    const { response: res, session } = await loginRequest(credentials.phone, credentials.password, apiUrl);
    
    if (session) {
      userSessions[userId] = session;
      userSessionExpiry[userId] = Date.now() + (6 * 60 * 60 * 1000); 
      
      const userInfo = await getUserInfo(session, userId);
      if (userInfo) {
        userGameInfo[userId] = userInfo;
        logging.info(`Session refreshed successfully for user ${userId}, new balance: ${userInfo.balance}`);
      }
      
      return true;
    } else {
      logging.error(`Failed to refresh session for user ${userId}: ${res.msg || res.error || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logging.error(`Error refreshing session for user ${userId}: ${error.message}`);
    return false;
  }
}

async function winLoseChecker(bot) {
  logging.info("Win/lose checker started");
  while (true) {
    try {
      for (const [userId, session] of Object.entries(userSessions)) {
        if (!session) continue;
        
        const settings = userSettings[userId] || {};
        const gameType = settings.game_type || "TRX";
        const betType = settings.bet_type || "BS";
        
        if (!await ensureValidSession(userId)) {
          if (settings.running) {
            settings.running = false;
            try {
              await bot.telegram.sendMessage(userId, "❌ Session expired. Please login again.", makeMainKeyboard(false));
            } catch (error) {
              logging.error(`Failed to send session expired message to ${userId}: ${error.message}`);
            }
          }
          continue;
        }
        
        let data;
        
        if (gameType === "WINGO30S") {
          const wingoRes = await getWingoGameResults(session);
          if (!wingoRes || wingoRes.code !== 0) {
            continue;
          }
          data = wingoRes.data?.list || [];
        } else {
          let issueRes = await getGameIssueRequest(session, gameType);
          
          if (!issueRes || issueRes.code !== 0) {
            continue;
          }
          
          data = issueRes.data ? [issueRes.data.settled || {}] : [];
        }
        
        if (userPendingBets[userId]) {
          for (const [currentIssue, betInfo] of Object.entries(userPendingBets[userId])) {
            let settled;
            if (gameType === "WINGO30S") {
              settled = data.find(item => item.issueNumber === currentIssue);
            } else {
              settled = data.find(item => item.issueNumber === currentIssue);
            }
            
            if (settled && settled.number !== undefined && settled.number !== null) {
              const [betChoice, amount, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const color = numberToColor(number);
              
              let isWin;
              if (betType === "COLOR") {
                isWin = betChoice === color;
              } else {
                isWin = (betChoice === "B" && bigSmall === "B") || (betChoice === "S" && bigSmall === "S");
              }
              
              if (settings.strategy === "TREND_FOLLOW" || settings.strategy === "CHAT_GPT" || settings.strategy === "CHANNEL_SIGNAL") {
                if (!userResultHistory[userId]) {
                  userResultHistory[userId] = [];
                }
                userResultHistory[userId].push(bigSmall);
                if (userResultHistory[userId].length > 20) {
                  userResultHistory[userId] = userResultHistory[userId].slice(-20);
                }
              }
              
              const entryLayer = settings.layer_limit || 1;
              if (entryLayer >= 2 && entryLayer <= 9 && settings.entry_layer_state) {
                if (settings.entry_layer_state.waiting_for_loses) {
                  if (!isWin) {
                    settings.entry_layer_state.consecutive_loses = (settings.entry_layer_state.consecutive_loses || 0) + 1;
                    logging.info(`Entry Layer ${entryLayer}: Consecutive losses increased to ${settings.entry_layer_state.consecutive_loses} for user ${userId}`);
                    if (settings.entry_layer_state.consecutive_loses >= settings.entry_layer_state.required_loses) {
                      settings.entry_layer_state.waiting_for_loses = false;
                      settings.entry_layer_state.real_betting_started = true;
                      logging.info(`Entry Layer ${entryLayer}: Required ${settings.entry_layer_state.required_loses} consecutive losses reached! Starting real betting for user ${userId}`);
                    }
                  } else {
                    settings.entry_layer_state.consecutive_loses = 0;
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.real_betting_started = false;
                    logging.info(`Entry Layer ${entryLayer}: Win during waiting period - reset consecutive losses to 0 for user ${userId}`);
                  }
                } else if (settings.entry_layer_state.real_betting_started) {
                  if (isWin) {
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.consecutive_loses = 0;
                    settings.entry_layer_state.real_betting_started = false;
                    logging.info(`Entry Layer ${entryLayer}: Win in real betting - reset entry layer completely for user ${userId}`);
                  }
                }
              }
              
              if (!isWin) {
                settings.consecutive_losses = (settings.consecutive_losses || 0) + 1;
                
                if (settings.sl_layer && settings.consecutive_losses >= settings.sl_layer) {
                  userShouldSkipNext[userId] = true;
                  userSLSkipWaitingForWin[userId] = true;
                  logging.info(`SL Layer triggered for user ${userId}. Skipping next bet after ${settings.consecutive_losses} consecutive losses.`);
                }
              } else {
                settings.consecutive_losses = 0;
                
                if (userSLSkipWaitingForWin[userId]) {
                  delete userSLSkipWaitingForWin[userId];
                  userShouldSkipNext[userId] = false;
                  logging.info(`SL Layer reset for user ${userId} after a win. Next bet will follow betting strategy.`);
                }
              }

              updateBettingStrategy(settings, isWin, amount);
              
              if (isVirtual) {
                if (!userStats[userId].virtual_balance) {
                  userStats[userId].virtual_balance = VIRTUAL_BALANCE;
                }
                
                if (isWin) {
                  userStats[userId].virtual_balance += amount * 0.96;
                } else {
                  userStats[userId].virtual_balance -= amount;
                }
              } else {
                if (userStats[userId] && amount > 0) {
                  if (isWin) {
                    const profitChange = amount * 0.96;
                    userStats[userId].profit += profitChange;
                  } else {
                    userStats[userId].profit -= amount;
                  }
                }
              }
      
              const currentProfit = isVirtual 
                ? (userStats[userId].virtual_balance - VIRTUAL_BALANCE)
                : (userStats[userId]?.profit || 0);
              const targetProfit = settings.target_profit; 
              
              if (settings.running && targetProfit && currentProfit >= targetProfit) {
                  logging.info(`User ${userId} - 💰 Profit Target [${targetProfit.toFixed(2)} Ks] Reached! Current Profit: ${currentProfit.toFixed(2)} Ks. Stopping bot.`);
         
                  settings.running = false;
                  settings.profit_stop_active = true; 

                  try {
                      const message = `🎉 PROFIT TARGET MET! 🎉\n\n🛒 Your Target PF: **${targetProfit.toFixed(2)} Ks**\n💳 Current Profit: **${currentProfit.toFixed(2)} Ks**.\n\nBot ကို ရပ်တန့်ထားပြီး နောက်တစ်ကြိမ် စတင်ရန် စီစဉ်ထားသည့် အချိန်အထိ ဆက်လက် ရပ်တန့်သွားပါမည်။`;
                      await bot.telegram.sendMessage(userId, message, makeMainKeyboard(false));
                  } catch (error) {
                      logging.error(`Failed to send profit target message to ${userId}: ${error.message}`);
                  }
     
                  delete userPendingBets[userId][currentIssue];
                  if (Object.keys(userPendingBets[userId]).length === 0) {
                      delete userPendingBets[userId];
                  }
                  userWaitingForResult[userId] = false;
                  continue; 
              }
             
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              
              const botStopped = await checkProfitAndStopLoss(userId, bot);
              if (botStopped) {
                delete userPendingBets[userId][currentIssue];
                if (Object.keys(userPendingBets[userId]).length === 0) {
                  delete userPendingBets[userId];
                }
                userWaitingForResult[userId] = false;
                continue;
              }
              
              let message;
              const platformName = getPlatformDisplayName(userLoginCredentials[userId]?.apiUrl || DEFAULT_BASE_URL);
              
              if (isWin) {
                const winAmount = amount * 0.96;
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - VIRTUAL_BALANCE)
                  : (userStats[userId]?.profit || 0);
                
                let profitIndicator = "";
                if (totalProfit > 0) {
                  profitIndicator = "+";
                } else if (totalProfit < 0) {
                  profitIndicator = "-";
                }
                
                message = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n⛳ Result: ${bigSmall} ( 🟩 WIN )\n━━━━━━━━━━━━━━━━━━━\n📊 Total :  ${currentBalance?.toFixed(2) || '0.00' } Ks\n📈 Profit: ${profitIndicator}${Math.abs(totalProfit).toFixed(2)} Ks\n━━━━━━━━━━━━━━━━━━━`;
              } else {
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - VIRTUAL_BALANCE)
                  : (userStats[userId]?.profit || 0);
                
                let profitIndicator = "";
                if (totalProfit > 0) {
                  profitIndicator = "+";
                } else if (totalProfit < 0) {
                  profitIndicator = "-";
                }
                
                let slMessage = "";
                if (settings.sl_layer && settings.consecutive_losses >= settings.sl_layer) {
                  slMessage = `\n⚠️ SL Layer (${settings.sl_layer})! Next Bet Skip`;
                }
                
                message = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n⛳ Result: ${bigSmall} ( 🟥 LOSE )\n━━━━━━━━━━━━━━━━━━━\n📊 Total :  ${currentBalance?.toFixed(2) || '0.00' } Ks\n📈 Profit: ${profitIndicator}${Math.abs(totalProfit).toFixed(2)} Ks\n━━━━━━━━━━━━━━━━━━━`;
              }
              
              try {
                await bot.telegram.sendMessage(userId, message);
                
                userDelayUntil[userId] = Date.now() + DELAY_AFTER_RESULT;
                logging.info(`Set ${DELAY_AFTER_RESULT/1000} second delay for user ${userId} after ${isWin ? 'WIN' : 'LOSE'} result`);
                
              } catch (error) {
                logging.error(`Failed to send result to ${userId}: ${error.message}`);
              }
              
              delete userPendingBets[userId][currentIssue];
              if (Object.keys(userPendingBets[userId]).length === 0) {
                delete userPendingBets[userId];
              }
              userWaitingForResult[userId] = false;
              
              logging.info(`Processed result for user ${userId}, issue ${currentIssue}: ${isWin ? 'WIN' : 'LOSE'}`);
            }
          }
        }
        
        if (userSkippedBets[userId]) {
          for (const [currentIssue, betInfo] of Object.entries(userSkippedBets[userId])) {
            let settled;
            if (gameType === "WINGO30S") {
              settled = data.find(item => item.issueNumber === currentIssue);
            } else {
              settled = data.find(item => item.issueNumber === currentIssue);
            }
            
            if (settled && settled.number !== undefined && settled.number !== null) {
              const [betChoice, isVirtual, skipReason, skipCount] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const color = numberToColor(number);
              
              let isWin;
              if (betType === "COLOR") {
                isWin = betChoice === color;
              } else {
                isWin = (betChoice === "B" && bigSmall === "B") || (betChoice === "S" && bigSmall === "S");
              }
              
              if (settings.strategy === "TREND_FOLLOW" || settings.strategy === "CHAT_GPT" || settings.strategy === "CHANNEL_SIGNAL") {
                if (!userResultHistory[userId]) {
                  userResultHistory[userId] = [];
                }
                userResultHistory[userId].push(bigSmall);
                if (userResultHistory[userId].length > 20) {
                  userResultHistory[userId] = userResultHistory[userId].slice(-20);
                }
              }
             
              const entryLayer = settings.layer_limit || 1;
              if (entryLayer >= 2 && entryLayer <= 9 && settings.entry_layer_state) {
                if (settings.entry_layer_state.waiting_for_loses) {
                  if (!isWin) {
                    settings.entry_layer_state.consecutive_loses = (settings.entry_layer_state.consecutive_loses || 0) + 1;
                    logging.info(`Entry Layer ${entryLayer}: Consecutive losses increased to ${settings.entry_layer_state.consecutive_loses} for user ${userId}`);
                    if (settings.entry_layer_state.consecutive_loses >= settings.entry_layer_state.required_loses) {
                      settings.entry_layer_state.waiting_for_loses = false;
                      settings.entry_layer_state.real_betting_started = true;
                      logging.info(`Entry Layer ${entryLayer}: Required ${settings.entry_layer_state.required_loses} consecutive losses reached! Starting real betting for user ${userId}`);
                    }
                  } else {
                    settings.entry_layer_state.consecutive_loses = 0;
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.real_betting_started = false;
                    logging.info(`Entry Layer ${entryLayer}: Win during waiting period - reset consecutive losses to 0 for user ${userId}`);
                  }
                } else if (settings.entry_layer_state.real_betting_started) {
                  if (isWin) {
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.consecutive_loses = 0;
                    settings.entry_layer_state.real_betting_started = false;
                    logging.info(`Entry Layer ${entryLayer}: Win in real betting - reset entry layer completely for user ${userId}`);
                  }
                }
              }
              
              if (!isWin) {
                settings.consecutive_losses = (settings.consecutive_losses || 0) + 1;
                
                if (settings.sl_layer && settings.consecutive_losses >= settings.sl_layer) {
                  userShouldSkipNext[userId] = true;
                  userSLSkipWaitingForWin[userId] = true;
                  logging.info(`SL Layer triggered for user ${userId}. Skipping next bet after ${settings.consecutive_losses} consecutive losses.`);
                }
              } else {
                settings.consecutive_losses = 0;
                
                if (userSLSkipWaitingForWin[userId]) {
                  delete userSLSkipWaitingForWin[userId];
                  userShouldSkipNext[userId] = false;
                  logging.info(`SL Layer reset for user ${userId} after a win. Next bet will follow betting strategy.`);
                }
              }
              
              let resultMessage;
              const totalWait = settings.bs_wait_count || 0;
              
              if (skipReason && skipReason.includes("BS/SB Wait")) {
                if (isWin) {
                  resultMessage = `🟢 WIN (Skip ${skipCount}/${totalWait}) \n🆔 ${getGameTypeDisplayName(gameType)}: ${formatPeriod(currentIssue)} => ${bigSmall}•${number}`;
                } else {
                  resultMessage = `🔴 LOSE (Skip ${skipCount}/${totalWait}) \n🆔 ${getGameTypeDisplayName(gameType)}: ${formatPeriod(currentIssue)} => ${bigSmall}•${number}`;
                }
              } else {
                resultMessage = isWin ? 
                  `🟢 WIN ${skipReason || 'Skipped'} \n🆔 ${getGameTypeDisplayName(gameType)}: ${formatPeriod(currentIssue)} => ${bigSmall}•${number}` :
                  `🔴 LOSE ${skipReason || 'Skipped'} \n🆔 ${getGameTypeDisplayName(gameType)}: ${formatPeriod(currentIssue)} => ${bigSmall}•${number}`;
              }
              
              try {
                await bot.telegram.sendMessage(userId, resultMessage);
                
                userDelayUntil[userId] = Date.now() + DELAY_AFTER_RESULT;
                logging.info(`Set ${DELAY_AFTER_RESULT/1000} second delay for user ${userId} after skipped bet result`);
                
              } catch (error) {
                logging.error(`Failed to send virtual result to ${userId}: ${error.message}`);
              }
              
              delete userSkippedBets[userId][currentIssue];
              if (Object.keys(userSkippedBets[userId]).length === 0) {
                delete userSkippedBets[userId];
              }
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, WIN_LOSE_CHECK_INTERVAL * 1000));
    } catch (error) {
      logging.error(`Win/lose checker error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

async function bettingWorker(userId, ctx, bot) {
  const settings = userSettings[userId] || {};
  let session = userSessions[userId];
  const gameType = settings.game_type || "TRX";
  const betType = settings.bet_type || "BS";
  
  if (!settings || !session) {
    await sendMessageWithRetry(ctx, "Please login first");
    settings.running = false;
    return;
  }
  
  userWaitingForResult[userId] = false;
  delete userPendingBets[userId];
  delete userSkippedBets[userId];
  delete userSkipResultWait[userId];
  delete userDelayUntil[userId];
  
  resetSkipPeriods(userId);
  
  if (!userStats[userId]) {
    userStats[userId] = {};
  }

  if (settings.virtual_mode) {
    userStats[userId].virtual_balance = VIRTUAL_BALANCE;
  } else {
    userStats[userId].profit = 0.0;
  }
  
  settings.original_martin_index = settings.martin_index || 0;
  settings.original_dalembert_units = settings.dalembert_units || 1;
  settings.original_custom_index = settings.custom_index || 0;
  
  settings.martin_index = settings.original_martin_index || 0;
  settings.dalembert_units = settings.original_dalembert_units || 1;
  settings.custom_index = settings.original_custom_index || 0;
  settings.consecutive_losses = 0;
  
  settings.running = true;
  settings.last_issue = null;
  settings.consecutive_errors = 0;
  settings.current_layer = 0;
  settings.skip_betting = false;
  
  userShouldSkipNext[userId] = false;
  delete userSLSkipWaitingForWin[userId];
  
  const entryLayer = settings.layer_limit || 1;
  if (entryLayer === 2) {
    settings.entry_layer_state = { 
      waiting_for_loses: true, 
      consecutive_loses: 0,
      required_loses: 1, 
      real_betting_started: false
    };
  } else if (entryLayer === 3) {
    settings.entry_layer_state = { 
      waiting_for_loses: true, 
      consecutive_loses: 0,
      required_loses: 2, 
      real_betting_started: false
    };
  } else if (entryLayer >= 4 && entryLayer <= 9) {
    settings.entry_layer_state = { 
      waiting_for_loses: true, 
      consecutive_loses: 0,
      required_loses: entryLayer - 1,  
      real_betting_started: false
    };
  }
  
  if (settings.strategy === "TREND_FOLLOW" || settings.strategy === "CHAT_GPT" || settings.strategy === "CHANNEL_SIGNAL") {
    userResultHistory[userId] = [];
    settings.bs_wait_active = false;
    settings.bs_wait_remaining = 0;
  }
  
  delete userSkippedBets[userId];
  userShouldSkipNext[userId] = false;
  delete userSLSkipWaitingForWin[userId];
  
  userWaitingForResult[userId] = false;
  
  let currentBalance = null;
  if (settings.virtual_mode) {
    currentBalance = userStats[userId].virtual_balance || VIRTUAL_BALANCE;
  } else {
    let balanceRetrieved = false;
    
    if (!await ensureValidSession(userId)) {
      logging.warning(`Session invalid for user ${userId}, attempting auto-login...`);
      
      const autoLoginSuccess = await autoLoginUserForMainBot(userId);
      if (!autoLoginSuccess) {
        await sendMessageWithRetry(ctx, "ကျေးဇူးပြု၍ LOGIN ပြန်ဝင်ပါ(❌Please check your connection or try again)", makeMainKeyboard(true));
        settings.running = false;
        return;
      }
    
      session = userSessions[userId];
    }
 
    for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt++) {
      try {
        const balanceResult = await getBalance(session, parseInt(userId));
        if (balanceResult !== null) {
          currentBalance = balanceResult;
          userStats[userId].start_balance = currentBalance;
          balanceRetrieved = true;
          break;
        }
      } catch (error) {
        logging.error(`Balance check attempt ${attempt + 1} failed: ${error.message}`);
  
        if (error.message.includes('unauthorized') || error.message.includes('token') || error.message.includes('login')) {
          logging.info(`Authentication error detected, attempting auto-login for user ${userId}`);
          const autoLoginSuccess = await autoLoginUserForMainBot(userId);
          if (autoLoginSuccess) {
            session = userSessions[userId]; 
            continue; 
          }
        }
      }
      
      if (attempt < MAX_BALANCE_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BALANCE_RETRY_DELAY * 1000));
      }
    }
    
    if (!balanceRetrieved) {
      logging.warning(`Final balance retrieval attempt with auto-login for user ${userId}`);
      const autoLoginSuccess = await autoLoginUserForMainBot(userId);
      if (autoLoginSuccess) {
        session = userSessions[userId];
        try {
          const finalBalanceResult = await getBalance(session, parseInt(userId));
          if (finalBalanceResult !== null) {
            currentBalance = finalBalanceResult;
            userStats[userId].start_balance = currentBalance;
            balanceRetrieved = true;
          }
        } catch (error) {
          logging.error(`Final balance attempt failed: ${error.message}`);
        }
      }
      
      if (!balanceRetrieved) {
        await sendMessageWithRetry(ctx, "ကျေးဇူးပြု၍ LOGIN ပြန်ဝင်ပါ(❌Please check your connection or try again)", makeMainKeyboard(true));
        settings.running = false;
        return;
      }
    }
  }
  
  let startMessage = `✅ BOT START\n\n`;
  startMessage += `💠 Balance: ${currentBalance} Ks\n\n`;
  startMessage += `🎯 Profit Target: ${settings.target_profit ? settings.target_profit + ' Ks' : '0 Ks'}\n`;
  startMessage += `🛡️ Stop Loss: ${settings.stop_loss ? settings.stop_loss + ' Ks' : '0 Ks'}\n\n`;
  
  if (settings.betting_strategy) {
    let bettingStrategyDisplay = "";
    switch (settings.betting_strategy) {
      case "Martingale":
        bettingStrategyDisplay = "Martingale";
        break;
      case "Anti-Martingale":
        bettingStrategyDisplay = "Anti-Martingale";
        break;
      case "D'Alembert":
        bettingStrategyDisplay = "D'Alembert";
        break;
      case "Custom":
        bettingStrategyDisplay = "Custom";
        break;
      default:
        bettingStrategyDisplay = settings.betting_strategy;
    }
    startMessage += `🚀 Betting Strategy: ${bettingStrategyDisplay}\n`;
  }
  
  if (settings.strategy) {
    let strategyDisplay = "";
    switch (settings.strategy) {
      case "CHAT_GPT":
        strategyDisplay = "Chat GPT Pattern Recognition";
        break;
      case "TREND_FOLLOW":
        strategyDisplay = "Trend Follow";
        if (settings.bs_wait_count > 0) {
          strategyDisplay += ` (BS/SB Wait: ${settings.bs_wait_count})`;
        }
        break;
      case "BS_ORDER":
        strategyDisplay = "BS Order";
        break;
      case "COLOR_TREND":
        strategyDisplay = "Color Trend";
        break;
      case "CHANNEL_SIGNAL":
        const channelName = savedChannels.find(ch => ch.id === settings.target_channel_id)?.name || "Unknown";
        strategyDisplay = `📡 Channel (${channelName})`;
        break;
      default:
        strategyDisplay = settings.strategy;
    }
    startMessage += `🧠 Strategy: ${strategyDisplay}\n`;
  }
  await sendMessageWithRetry(ctx, startMessage);
  
  try {
    while (settings.running) {
      if (userDelayUntil[userId] && Date.now() < userDelayUntil[userId]) {
        const remainingDelay = userDelayUntil[userId] - Date.now();
        if (remainingDelay > 0) {
          logging.info(`Waiting ${Math.ceil(remainingDelay/1000)} seconds before next bet for user ${userId}`);
          await new Promise(resolve => setTimeout(resolve, Math.min(1000, remainingDelay)));
          continue;
        } else {
          delete userDelayUntil[userId];
        }
      }
      
      if (userWaitingForResult[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (userSkipResultWait[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (!settings.virtual_mode && !await ensureValidSession(userId)) {
        settings.running = false;
        await sendMessageWithRetry(ctx, "❌ Session expired. Auto-login failed. Please login again.", makeMainKeyboard(false));
        break;
      }
      
      session = userSessions[userId];
      
      if (settings.virtual_mode) {
        currentBalance = userStats[userId].virtual_balance || VIRTUAL_BALANCE;
      } else {
        try {
        
          if (!await ensureValidSession(userId)) {
            logging.warning(`Session expired during betting for user ${userId}, attempting auto-login...`);
            const autoLoginSuccess = await autoLoginUserForMainBot(userId);
            if (!autoLoginSuccess) {
              settings.running = false;
              await sendMessageWithRetry(ctx, "❌ Session expired. Auto-login failed. Please login again.", makeMainKeyboard(false));
              break;
            }
            session = userSessions[userId]; 
          }
          
          const balanceResult = await getBalance(session, parseInt(userId));
          if (balanceResult !== null) {
            currentBalance = balanceResult;
          } else {
         
            logging.warning(`Balance returned null for user ${userId}, attempting auto-login...`);
            const autoLoginSuccess = await autoLoginUserForMainBot(userId);
            if (autoLoginSuccess) {
              session = userSessions[userId];
              const retryBalance = await getBalance(session, parseInt(userId));
              if (retryBalance !== null) {
                currentBalance = retryBalance;
              } else {
             
                if (currentBalance === null) {
                  currentBalance = userStats[userId].start_balance || 0;
                }
              }
            } else {
            
              if (currentBalance === null) {
                currentBalance = userStats[userId].start_balance || 0;
              }
            }
          }
        } catch (error) {
          logging.error(`Balance check failed: ${error.message}`);
        
          if (currentBalance === null) {
            currentBalance = userStats[userId].start_balance || 0;
          }
        }
      }
      
      if (currentBalance === null) {
        logging.error(`Current balance is null for user ${userId}, attempting to recover`);
        let recovered = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
           
            if (!await ensureValidSession(userId)) {
              const autoLoginSuccess = await autoLoginUserForMainBot(userId);
              if (!autoLoginSuccess) {
                settings.running = false;
                await sendMessageWithRetry(ctx, "❌ Session expired. Auto-login failed. Please login again.", makeMainKeyboard(false));
                break;
              }
              session = userSessions[userId];
            }
            
            const balanceResult = await getBalance(session, parseInt(userId));
            if (balanceResult !== null) {
              currentBalance = balanceResult;
              recovered = true;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            logging.error(`Balance recovery attempt ${attempt + 1} failed: ${error.message}`);
          }
        }
        
        if (!recovered) {
          await sendMessageWithRetry(ctx, "❌ Failed to recover balance. Stopping bot to prevent errors.", makeMainKeyboard(true));
          settings.running = false;
          break;
        }
      }
      
      const betSizes = settings.bet_sizes || [100];
      if (!betSizes.length) {
        await sendMessageWithRetry(ctx, "Bot is not working at the moment because some Bot Settings are still to be configured !", makeMainKeyboard(true));
        settings.running = false;
        break;
      }
      
      const minBetSize = Math.min(...betSizes);
      if (currentBalance < minBetSize) {
        const message = `❌ Insufficient balance!\n` +
                        `Current Balance: ${currentBalance.toFixed(2)} Ks\n` +
                        `Minimum Bet Required: ${minBetSize} Ks\n` +
                        `Please add funds to continue betting.`;
        await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
        settings.running = false;
        break;
      }
      
      const balanceWarningThreshold = minBetSize * 3;
      const now = Date.now();
      const lastWarning = userBalanceWarnings[userId] || 0;
      
      if (currentBalance < balanceWarningThreshold && currentBalance >= minBetSize && (now - lastWarning > 60000)) {
        const warningMessage = `⚠️ Balance Warning!\n` +
                              `⛔ Current Balance: ${currentBalance.toFixed(2)} Ks\n` +
                              `❓ Minimum Bet: ${minBetSize} Ks\n` +
                              `✅ Consider adding funds soon to avoid interruption.`;
        await sendMessageWithRetry(ctx, warningMessage);
        userBalanceWarnings[userId] = now;
      }
      
      if (settings.schedule_enabled && settings.manual_start_with_schedule) {
        const now = getMyanmarTime();
        const currentTimeStr = formatTime(now);
        const currentTotalMinutes = timeToMinutes(currentTimeStr);
        
        const startTimes = settings.schedule_start_times || [];
        const stopTimes = settings.schedule_stop_times || [];
        
        let isInAnyWindow = false;
        
        for (let i = 0; i < Math.min(startTimes.length, stopTimes.length); i++) {
          const startMins = timeToMinutes(startTimes[i]);
          const stopMins = timeToMinutes(stopTimes[i]);
          
          let inThisWindow = false;
          
          if (startMins < stopMins) {
            inThisWindow = (currentTotalMinutes >= startMins && currentTotalMinutes < stopMins);
          } else {
            inThisWindow = (currentTotalMinutes >= startMins || currentTotalMinutes < stopMins);
          }
          
          if (inThisWindow) {
            isInAnyWindow = true;
            break;
          }
        }
        
        if (!isInAnyWindow) {
          logging.info(`User ${userId} - Schedule stop time reached during betting. Stopping bot.`);
          
          settings.running = false;
          settings.manual_start_with_schedule = false;
          
          let totalProfit = 0;
          let balanceText = "";
          
          if (settings.virtual_mode) {
            totalProfit = (userStats[userId]?.virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
            balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || VIRTUAL_BALANCE).toFixed(2)} Ks\n`;
          } else {
            totalProfit = userStats[userId]?.profit || 0;
            try {
              const session = userSessions[userId];
              const finalBalance = await getBalance(session, userId);
              balanceText = `💰 Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
            } catch (error) {
              balanceText = "Final Balance: Unknown\n";
            }
          }
          
          let profitIndicator = totalProfit > 0 ? "+" : (totalProfit < 0 ? "-" : "");
          
          const message = `⏰ TIMER SETTING STOP\n${balanceText}💰 Total Profit: ${profitIndicator}${Math.abs(totalProfit).toFixed(2)} Ks\n\nStop time reached. Bot auto-stopped.`;
          
          await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
          break;
        }
      }
      
      let issueRes;
      try {
        issueRes = await getGameIssueRequest(session, gameType);
        if (!issueRes || issueRes.code !== 0) {
          settings.consecutive_errors++;
          if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
            await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
            settings.running = false;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      } catch (error) {
        logging.error(`Error getting issue: ${error.message}`);
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      settings.consecutive_errors = 0;
      
      const data = issueRes.data || {};
      let currentIssue;
      
      if (gameType === "TRX") {
        currentIssue = data.predraw?.issueNumber;
      } else {
        currentIssue = data.issueNumber;
      }
      
      if (!currentIssue || currentIssue === settings.last_issue) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      let ch;
      let shouldSkipForStrategy = false;
      let skipReason = "";
      let signalInfo = "";
      
      if (settings.strategy === "CHANNEL_SIGNAL") {
        const targetId = settings.target_channel_id;
        
        if (targetId) {
          const signalPrediction = await getSpecificChannelPrediction(targetId, currentIssue);
          ch = signalPrediction.result;
          shouldSkipForStrategy = signalPrediction.shouldSkip;
          skipReason = signalPrediction.skipReason;
          signalInfo = signalPrediction.signalInfo;
        } else {
          shouldSkipForStrategy = true;
          skipReason = "⚠️ Please select a channel from Strategy Menu";
        }
      }
    
      else if (settings.strategy === "CHAT_GPT") {
        const prediction = await getChatGPTPrediction(userId);
        if (prediction) {
          ch = prediction.result;
          shouldSkipForStrategy = prediction.shouldSkip || false;
          if (shouldSkipForStrategy) {
            skipReason = "ChatGPT Skip";
          }
        } else {
          ch = Math.random() < 0.5 ? 'B' : 'S';
        }
      } else if (settings.strategy === "BS_ORDER") {
        if (!settings.pattern) {
          settings.pattern = DEFAULT_BS_ORDER;
          settings.pattern_index = 0;
          await sendMessageWithRetry(ctx, `No BS order provided. Using default: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true));
        }
        
        const pattern = settings.pattern;
        const patternIndex = settings.pattern_index || 0;
        ch = pattern[patternIndex % pattern.length];
      } else if (settings.strategy === "TREND_FOLLOW") {
        const bsWaitCount = settings.bs_wait_count || 0;
        
        let shouldSkipForTrend = false;
        let skipReason = "";
        
        if (settings.bs_wait_active) {
          shouldSkipForTrend = true;
          skipReason = `BS/SB Wait Active`;
        } else if (bsWaitCount > 0 && userResultHistory[userId] && userResultHistory[userId].length >= bsWaitCount * 2) {
          const bsPattern = "BS".repeat(bsWaitCount);
          const sbPattern = "SB".repeat(bsWaitCount);
          const hasBSPattern = checkPatternInHistory(userResultHistory[userId], bsPattern);
          const hasSBPattern = checkPatternInHistory(userResultHistory[userId], sbPattern);
          
          if (hasBSPattern || hasSBPattern) {
            shouldSkipForTrend = true;
            skipReason = `BS/SB Wait ${bsWaitCount}`;
            settings.bs_wait_active = true;
            settings.bs_wait_remaining = bsWaitCount;
          }
        }
        
        if (userResultHistory[userId] && userResultHistory[userId].length > 0) {
          const lastResult = userResultHistory[userId][userResultHistory[userId].length - 1];
          ch = lastResult;
        } else {
          ch = Math.random() < 0.5 ? 'B' : 'S';
        }
        
        if (shouldSkipForTrend) {
          userShouldSkipNext[userId] = true;
          settings.trend_skip_reason = skipReason;
          
          if (settings.bs_wait_active && settings.bs_wait_remaining > 0) {
            settings.bs_wait_remaining--;
            if (settings.bs_wait_remaining === 0) {
              settings.bs_wait_active = false;
            }
          }
        } else {
          userShouldSkipNext[userId] = false;
          delete settings.trend_skip_reason;
        }
      } else if (settings.strategy === "COLOR_TREND") {
        const colorPrediction = await getColorPrediction(userId);
        if (colorPrediction) {
          ch = colorPrediction.result;
        } else {
          ch = 'G';
        }
      } else {
        if (userResultHistory[userId] && userResultHistory[userId].length > 0) {
          const lastResult = userResultHistory[userId][userResultHistory[userId].length - 1];
          ch = lastResult;
        } else {
          ch = Math.random() < 0.5 ? 'B' : 'S';
        }
      }
      
      if (betType === "COLOR") {
        const colorPrediction = await getColorPrediction(userId);
        if (colorPrediction) {
          ch = colorPrediction.result;
        } else {
          ch = 'G';
        }
      }
      
      const selectType = getSelectMap(betType)[ch];
      
      if (selectType === undefined) {
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      let betMsg;
      let shouldSkip = false;
      
      if (shouldSkipForStrategy) {
        shouldSkip = true;
        if (!skipReason) {
          skipReason = "SKIP Please Wait";
        }
      }
      
      const entryLayer = settings.layer_limit || 1;
      if (entryLayer >= 2 && entryLayer <= 9) {
        if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
          shouldSkip = true;
          skipReason = `Entry Layer ${entryLayer} (${settings.entry_layer_state.consecutive_loses || 0}/${settings.entry_layer_state.required_loses} )`;
          
          if (!userSkippedBets[userId]) {
            userSkippedBets[userId] = {};
          }
          userSkippedBets[userId][currentIssue] = [ch, settings.virtual_mode, skipReason];
          
          const platformName = getPlatformDisplayName(userLoginCredentials[userId]?.apiUrl || DEFAULT_BASE_URL);
          if (betType === "COLOR") {
            betMsg = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n🚨 Order : ${getColorName(ch)} => ${skipReason}\n━━━━━━━━━━━━━━━━━━━`;
          } else {
            betMsg = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n🚨 Order : ${ch === 'B' ? 'BIG' : 'SMALL'} => ${skipReason}\n━━━━━━━━━━━━━━━━━━━`;
          }
          
          await sendMessageWithRetry(ctx, betMsg);
          
          userSkipResultWait[userId] = currentIssue;
          
          let resultAvailable = false;
          let waitAttempts = 0;
          const maxWaitAttempts = 60;
          
          while (!resultAvailable && waitAttempts < maxWaitAttempts && settings.running) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (!userSkipResultWait[userId] || userSkipResultWait[userId] !== currentIssue) {
              resultAvailable = true;
            }
            
            waitAttempts++;
          }
          
          if (!resultAvailable) {
            if (userSkipResultWait[userId] === currentIssue) {
              delete userSkipResultWait[userId];
            }
          }
          
          settings.last_issue = currentIssue;
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      
      if (settings.sl_layer && settings.consecutive_losses >= settings.sl_layer) {
        shouldSkip = true;
        if (!skipReason) {
          skipReason = `SL Layer (${settings.sl_layer})`;
        }
        userSLSkipWaitingForWin[userId] = true;
      }
      
      if (userSLSkipWaitingForWin[userId] && !shouldSkip) {
        delete userSLSkipWaitingForWin[userId];
        userShouldSkipNext[userId] = false;
        logging.info(`SL Skip reset - proceeding with normal betting strategy`);
      }
      
      if (settings.strategy === "TREND_FOLLOW" && userShouldSkipNext[userId]) {
        shouldSkip = true;
        if (!skipReason) {
          skipReason = settings.trend_skip_reason || "Skipped";
        }
      }
      
      if (shouldSkip) {
        const platformName = getPlatformDisplayName(userLoginCredentials[userId]?.apiUrl || DEFAULT_BASE_URL);
        if (betType === "COLOR") {
          betMsg = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n🚨 Order : ${getColorName(ch)} => ${skipReason}\n━━━━━━━━━━━━━━━━━━━`;
        } else {
          betMsg = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period :${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n🚨 Order : ${ch === 'B' ? 'BIG' : 'SMALL'} => ${skipReason}\n━━━━━━━━━━━━━━━━━━━`;
        }

        if (!userSkippedBets[userId]) {
          userSkippedBets[userId] = {};
        }
        
        let skipCount = 0;
        if (settings.strategy === "TREND_FOLLOW" && settings.bs_wait_count > 0) {
          skipCount = settings.bs_wait_count - (settings.bs_wait_remaining || 0);
        }
        
        userSkippedBets[userId][currentIssue] = [ch, settings.virtual_mode, skipReason, skipCount];
        
        userSkipResultWait[userId] = currentIssue;
        
        await sendMessageWithRetry(ctx, betMsg);
        
        let resultAvailable = false;
        let waitAttempts = 0;
        const maxWaitAttempts = 60;
        
        while (!resultAvailable && waitAttempts < maxWaitAttempts && settings.running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (!userSkipResultWait[userId] || userSkipResultWait[userId] !== currentIssue) {
            resultAvailable = true;
          }
          
          waitAttempts++;
        }
        
        if (!resultAvailable) {
          if (userSkipResultWait[userId] === currentIssue) {
            delete userSkipResultWait[userId];
          }
        }
        
        settings.last_issue = currentIssue;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      } else {
        let desiredAmount;
        try {
          desiredAmount = calculateBetAmount(settings, currentBalance);
        } catch (error) {
          await sendMessageWithRetry(ctx, 
                        `❌ ${error.message}\n` +
            `Please stop bot and set Bet Size again.`,
            makeMainKeyboard(true)
          );
          settings.running = false;
          break;
        }
        
        const { unitAmount, betCount, actualAmount } = computeBetDetails(desiredAmount);
        
        if (actualAmount === 0) {
          await sendMessageWithRetry(ctx, 
            `❌ Invalid bet amount: ${desiredAmount} Ks\n` +
            `Minimum bet amount is ${unitAmount} Ks\n` +
            `Please increase your bet size.`,
            makeMainKeyboard(true)
          );
          settings.running = false;
          break;
        }
        
        if (currentBalance < actualAmount) {
          const message = `❌ Insufficient balance for next bet!\n` +
                          `Current Balance: ${currentBalance.toFixed(2)} Ks\n` +
                          `Required Bet Amount: ${actualAmount.toFixed(2)} Ks\n` +
                          `Please add funds to continue betting.`;
          await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
          settings.running = false;
          break;
        }
        
        let strategyInfo = "";
        if (settings.strategy === "TREND_FOLLOW") {
          strategyInfo = "\n🧠 Strategy: Trend Follow";
          if (settings.bs_wait_count > 0) {
            strategyInfo += `\n⏳ BS/SB Wait: ${settings.bs_wait_count}`;
          }
          if (userResultHistory[userId] && userResultHistory[userId].length > 0) {
            strategyInfo += `\n📊 History: ${userResultHistory[userId].slice(-5).join('')}`;
          }
          if (settings.bs_wait_active) {
            strategyInfo += `\n⏳ Wait Active (${settings.bs_wait_remaining} remaining)`;
          }
        } else if (settings.strategy === "CHAT_GPT") {
          strategyInfo = "\n🧠 Strategy: Chat GPT Pattern Recognition";
        } else if (settings.strategy === "BS_ORDER") {
          strategyInfo = "\n🧠 Strategy: BS Order";
        } else if (settings.strategy === "COLOR_TREND") {
          strategyInfo = "\n🧠 Strategy: Color Trend";
        } else if (settings.strategy === "CHANNEL_SIGNAL") {
          const channelName = savedChannels.find(ch => ch.id === settings.target_channel_id)?.name || "Unknown";
          strategyInfo = `\n🧠 Strategy: Channel Signal (${channelName})`;
        }
        
        const platformName = getPlatformDisplayName(userLoginCredentials[userId]?.apiUrl || DEFAULT_BASE_URL);
        if (betType === "COLOR") {
          betMsg = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n🎲 Order : ${getColorName(ch)} => ${actualAmount} Ks\n━━━━━━━━━━━━━━━━━━━`;
        } else {
          betMsg = `🌌 ⟦${platformName}⟧ - ${getGameTypeDisplayName(gameType)}⚡️\n\n🆔 Period: ${formatPeriod(currentIssue)}\n━━━━━━━━━━━━━━━━━━━\n🎲 Order : ${ch === 'B' ? 'BIG' : 'SMALL'} => ${actualAmount} Ks\n━━━━━━━━━━━━━━━━━━━`;
        }
        await sendMessageWithRetry(ctx, betMsg);
        
        if (settings.virtual_mode) {
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, true];
          userWaitingForResult[userId] = true;
        } else {
          const betResp = await placeBetRequest(session, currentIssue, selectType, unitAmount, betCount, gameType, parseInt(userId));
          
          if (betResp.error || betResp.code !== 0) {
            await sendMessageWithRetry(ctx, `Bet error: ${betResp.msg || betResp.error}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, false];
          userWaitingForResult[userId] = true;
        }
      }
      
      settings.last_issue = currentIssue;
      if (settings.pattern || settings.strategy === "BS_ORDER") {
        settings.pattern_index = (settings.pattern_index + 1) % (settings.pattern ? settings.pattern.length : 10);
      }
    
      const botStopped = await checkProfitAndStopLoss(userId, bot);
      if (botStopped) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    logging.error(`Betting worker error for user ${userId}: ${error.message}`);
    await sendMessageWithRetry(ctx, `Betting error: ${error.message}. Stopping...`);
    settings.running = false;
  } finally {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    delete userBalanceWarnings[userId];
    delete userSkipResultWait[userId];
    delete userSLSkipWaitingForWin[userId];
    delete userDelayUntil[userId]; 
    delete settings.trend_skip_reason;
    resetSkipPeriods(userId);
    
    if (settings.strategy === "TREND_FOLLOW" || settings.strategy === "CHAT_GPT" || settings.strategy === "CHANNEL_SIGNAL") {
      delete userResultHistory[userId];
      settings.bs_wait_active = false;
    }
    
    let totalProfit = 0;
    let balanceText = "";
    
    if (settings.virtual_mode) {
      totalProfit = (userStats[userId]?.virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
      balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || VIRTUAL_BALANCE).toFixed(2)} Ks\n`;
    } else {
      totalProfit = userStats[userId]?.profit || 0;
      try {
        const finalBalance = await getBalance(session, userId);
        balanceText = `💰 Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
      } catch (error) {
        balanceText = "Final Balance: Unknown\n";
      }
    }
    
    let profitIndicator = "";
    if (totalProfit > 0) {
      profitIndicator = "+";
    } else if (totalProfit < 0) {
      profitIndicator = "-";
    } else {
      profitIndicator = "";
    }
    settings.original_martin_index = 0;
    settings.original_dalembert_units = 1;
    settings.original_custom_index = 0;
    
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    
    if (!userStopInitiated[userId]) {
      const message = `🚫 BOT STOPPED\n${balanceText}💰 Total Profit: ${profitIndicator}${Math.abs(totalProfit).toFixed(2)} Ks`;
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    }
    
    delete userStopInitiated[userId];
  }
}

function makeMainKeyboard(loggedIn = false) {
  if (!loggedIn) {
    return Markup.keyboard([["🔐 Login"]]).resize().oneTime(false);
  }
  return Markup.keyboard([
    [ "🔐 Login" ,"🏁 Info"],
    ["🎲 WINGO/TRX", "🎯 Bet Type"],
    ["💣 Bet_Size", "🚀 Anti/Martingale" ],
    ["🧠 Strategy"],
    ["🏹 Profit Target", "🔥 Stop Loss Limit"],
    ["🔄 Entry Layer", "💥 Bet_SL"],
    ["⏰ Time Settings"], 
    ["⚔️ Start","🛡️ Stop"],
    ["🎮 Virtual/Real Mode"]
  ]).resize().oneTime(false);
}

function makeStrategyKeyboard(userId) {
  const settings = userSettings[userId] || {};
  const gameType = settings.game_type || "TRX";
  const betType = settings.bet_type || "BS";
  const buttons = [];
  
  if (betType === "COLOR") {
    buttons.push([
      Markup.button.callback("🎨 Color Trend", "strategy:COLOR_TREND")
    ]);
  } else {
    savedChannels.forEach(ch => {
      buttons.push([
        Markup.button.callback(`📡 ${ch.name}`, `strategy:CHANNEL_SIGNAL:${ch.id}`)
      ]);
    });
    
    buttons.push([
      Markup.button.callback("🤖 Chat GPT", "strategy:CHAT_GPT")
    ]);
    
    buttons.push([
      Markup.button.callback("🐯 TrendFollow V1", "strategy:TREND_FOLLOW")
    ]);
    
    buttons.push([
      Markup.button.callback("🐷 BS-Order", "strategy:BS_ORDER")
    ]);
  }
  
  return Markup.inlineKeyboard(buttons);
}

function makeWingoStrategyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📡 Channel Signal", "strategy:CHANNEL_SIGNAL")],
    [Markup.button.callback("🤖 Chat GPT", "strategy:CHAT_GPT")],
    [Markup.button.callback("🐯 TrendFollow V1", "strategy:TREND_FOLLOW")],
    [Markup.button.callback("🐷 BS-Order", "strategy:BS_ORDER")]
  ]);
}

function makeBettingStrategyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Anti-Martingale", "betting_strategy:Anti-Martingale")],
    [Markup.button.callback("Martingale", "betting_strategy:Martingale")],
    [Markup.button.callback("D'Alembert", "betting_strategy:D'Alembert")]
  ]);
}

function makeGameTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("WINGO30S", "game_type:WINGO30S")],
    [Markup.button.callback("TRX", "game_type:TRX")]
  ]);
}

function makeBetTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Big/Small", "bet_type:BS")],
    [Markup.button.callback("Color", "bet_type:COLOR")]
  ]);
}

function makeEntryLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1 - Direct  For BET", "entry_layer:1")],
    [Markup.button.callback("2 - Wait for 1 Lose", "entry_layer:2")],
    [Markup.button.callback("3 - Wait for 2 Loses", "entry_layer:3")],
    [Markup.button.callback("4 - Wait for 3 Loses", "entry_layer:4")],
    [Markup.button.callback("5 - Wait for 4 Loses", "entry_layer:5")],
    [Markup.button.callback("6 - Wait for 5 Loses", "entry_layer:6")],
    [Markup.button.callback("7 - Wait for 6 Loses", "entry_layer:7")],
    [Markup.button.callback("8 - Wait for 7 Loses", "entry_layer:8")],
    [Markup.button.callback("9 - Wait for 8 Loses", "entry_layer:9")]
  ]);
}

function makeSLLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("0 - Disabled", "sl_layer:0")],
    [Markup.button.callback("1", "sl_layer:1"), Markup.button.callback("2", "sl_layer:2"), Markup.button.callback("3", "sl_layer:3")],
    [Markup.button.callback("4", "sl_layer:4"), Markup.button.callback("5", "sl_layer:5"), Markup.button.callback("6", "sl_layer:6")],
    [Markup.button.callback("7", "sl_layer:7"), Markup.button.callback("8", "sl_layer:8"), Markup.button.callback("9", "sl_layer:9")]
  ]);
}

function makeModeSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🖥️ Virtual Mode", "mode:virtual")],
    [Markup.button.callback("💵 Real Mode", "mode:real")]
  ]);
}

function makeNumberPadKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("O (disable)", "number:0")],
    [Markup.button.callback("1", "number:1"), Markup.button.callback("2", "number:2"), Markup.button.callback("3", "number:3")],
    [Markup.button.callback("4", "number:4"), Markup.button.callback("5", "number:5"), Markup.button.callback("6", "number:6")],
    [Markup.button.callback("7", "number:7"), Markup.button.callback("8", "number:8"), Markup.button.callback("9", "number:9")]
  ]);
}

function makeScheduleOptionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🕐 Start Times", "schedule:start_time")],
    [Markup.button.callback("🗑️ Reset All Times", "schedule:reset_all")]
  ]);
}

function makePlatformSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("❤ SIX Lottery", "platform:6LOTTERY")],
    [Markup.button.callback("💚 777 BigWin", "platform:777BIGWIN")],
    [Markup.button.callback("💙 CK Lottery ", "platform:CKLOTTERY")]
  ]);
}

function logoutUser(userId) {
  delete userSessions[userId];
  delete userGameInfo[userId];
  delete userLoginCredentials[userId];
  delete userSessionExpiry[userId];
  delete userTemp[userId];
  
  if (userSettings[userId]) {
    userSettings[userId].running = false;
  }
  
  delete userWaitingForResult[userId];
  delete userPendingBets[userId];
  delete userSkippedBets[userId];
  delete userShouldSkipNext[userId];
  delete userSLSkipWaitingForWin[userId];
  delete userDelayUntil[userId];
  
  logging.info(`User ${userId} logged out and all sessions cleared`);
}

async function checkUserAuthorized(ctx) {
  const userId = ctx.from.id;
  if (!userSessions[userId]) {
    await sendMessageWithRetry(ctx, "Please Login ", makeMainKeyboard(false));
    return false;
  }
  if (!userSettings[userId]) {
    userSettings[userId] = getDefaultUserSettings();
    saveUserSettings();
  }
  return true;
}

async function cmdStartHandler(ctx) {
  const userId = ctx.from.id;
  
  addUserToAllList(userId);
  
  const result = await withCommandLock(userId, async () => {
    if (!userSettings[userId]) {
      userSettings[userId] = getDefaultUserSettings();
      saveUserSettings();
    }
    const loggedIn = !!userSessions[userId];
    await sendMessageWithRetry(ctx, "⟦𝐃𝐑𝐄𝐀𝐌 𝐓𝐑𝐀𝐌⟧⟦𝐀𝐔𝐓𝐎 𝐁𝐄𝐓 𝐁𝐎𝐓⟧မှကြိုဆိုပါ၏်🫶!", makeMainKeyboard(loggedIn));
    return true;
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdAllowHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) {
      await sendMessageWithRetry(ctx, "Admin only!");
      return;
    }
    const args = ctx.message.text.split(' ').slice(1);
    if (!args.length || !args[0].match(/^\d+$/)) {
      await sendMessageWithRetry(ctx, "Usage: /allow {6lottery_id}");
      return;
    }
    const bigwinId = parseInt(args[0]);
    if (allowed777bigwinIds.has(bigwinId)) {
      await sendMessageWithRetry(ctx, `User ${bigwinId} already added`);
    } else {
      allowed777bigwinIds.add(bigwinId);
      saveAllowedUsers();
      await sendMessageWithRetry(ctx, `User ${bigwinId} added`);
    }
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdRemoveHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) {
      await sendMessageWithRetry(ctx, "Admin only!");
      return;
    }
    const args = ctx.message.text.split(' ').slice(1);
    if (!args.length || !args[0].match(/^\d+$/)) {
      await sendMessageWithRetry(ctx, "Usage: /remove {6lottery_id}");
      return;
    }
    const bigwinId = parseInt(args[0]);
    if (!allowed777bigwinIds.has(bigwinId)) {
      await sendMessageWithRetry(ctx, `User ${bigwinId} not found`);
    } else {
      allowed777bigwinIds.delete(bigwinId);
      saveAllowedUsers();
      await sendMessageWithRetry(ctx, `User ${bigwinId} removed`);
    }
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdShowHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) {
      await sendMessageWithRetry(ctx, "Admin only!");
      return;
    }
    
    const allowedIds = Array.from(allowed777bigwinIds);
    if (allowedIds.length === 0) {
      await sendMessageWithRetry(ctx, "No users have been added yet.");
      return;
    }
    
    let message = "🧔 User ID List\n\n";
    allowedIds.forEach((id, index) => {
      message += `${index + 1}. ${id}\n`;
    });
    
    message += `\nTotal: ${allowedIds.length} users`;
    await sendMessageWithRetry(ctx, message);
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdSendHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) {
      await sendMessageWithRetry(ctx, "Admin only!");
      return;
    }
    
    const messageText = ctx.message.text.substring(6).trim();
    if (!messageText) {
      await sendMessageWithRetry(ctx, "Usage: /send (message)");
      return;
    }
    
    const fullMessage = `🗞ADMIN ထံမှအကြောင်းကြားစာ:\n\n${messageText}`;

    let successCount = 0;
    let failCount = 0;
    
    const uniqueUsers = new Set();
    
    allUsers.forEach(id => uniqueUsers.add(id));
    
    Object.keys(userSessions).forEach(id => uniqueUsers.add(id));
    
    for (const userIdStr of uniqueUsers) {
      try {
        await ctx.telegram.sendMessage(userIdStr, fullMessage);
        successCount++;
      } catch (error) {
        logging.error(`Failed to send broadcast message to user ${userIdStr}: ${error.message}`);
        failCount++;
      }
    }
    
    const reportMessage = `✅ Broadcast Report:\n\n` +
                         `📤 Total Messages Sent: ${successCount}\n` +
                         `❌ Failed: ${failCount}`;
    
    await sendMessageWithRetry(ctx, reportMessage);
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdUsersHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) {
      await sendMessageWithRetry(ctx, "Admin only!");
      return;
    }
    
    const totalUsers = allUsers.size;
    const loggedInUsers = Object.keys(userSessions).length;
    const notLoggedInUsers = totalUsers - loggedInUsers;
    
    const message = `📊 Users Statistics:\n\n` +
                   `👥 Total Users (Started Bot): ${totalUsers}\n` +
                   `✅ Logged In Users: ${loggedInUsers}\n` +
                   `❌ Not Logged In: ${notLoggedInUsers}`;
    
    await sendMessageWithRetry(ctx, message);
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdSignalHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) {
      await sendMessageWithRetry(ctx, "Admin only!");
      return;
    }

    if (savedChannels.length === 0) {
      await sendMessageWithRetry(ctx, "📡 No channels have been added yet.\nUse /addchannel to add a signal source.");
      return;
    }

    let message = `📡 CHANNEL SIGNAL STATUS\n\n`;
    
    savedChannels.forEach(ch => {
      const signal = channelSignals[ch.id];
      let status = "🔴 NO SIGNAL";
      let details = "";
      
      if (signal) {
        const signalAge = Date.now() - signal.receivedAt;
        if (signalAge > CHANNEL_SIGNAL_EXPIRY_TIME) {
          status = "🔴 EXPIRED";
        } else {
          status = "🟢 ACTIVE";
        }
        details = `\n  Period: ${signal.fullPeriod}\n  Prediction: ${signal.prediction === 'B' ? 'BIG' : 'SMALL'}\n  Age: ${Math.floor(signalAge / 1000)}s`;
      }
      
      message += `📌 ${ch.name} (ID: ${ch.id})\n  Status: ${status}${details}\n\n`;
    });
    
    await sendMessageWithRetry(ctx, message);
  });

  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdAddChannelHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) return;
    const text = ctx.message.text;
    const regex = /\/addchannel\s+([-\w]+)\s+"([^"]+)"\s+(\d+)/;
    const match = text.match(regex);

    if (!match) {
      return ctx.reply('Usage: /addchannel ID "Name" Confidence\nEx: /addchannel -100123456 "AlinKar-Signal" 65');
    }

    if (savedChannels.length >= 10) {
      return ctx.reply('❌ Max 10 channels allowed in menu strategy!');
    }

    const newChannel = {
      id: match[1],
      name: match[2],
      reliability: parseInt(match[3])
    };

    const exists = savedChannels.find(ch => ch.id === newChannel.id);
    if (exists) {
      return ctx.reply('⚠️ Channel ID already exists. Remove it first.');
    }

    savedChannels.push(newChannel);
    saveSavedChannels();
    ctx.reply(`✅ Added Channel:\nName: ${newChannel.name}\nID: ${newChannel.id}\nConf: ${newChannel.reliability}%`);
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function cmdRemoveChannelHandler(ctx) {
  const userId = ctx.from.id;
  const result = await withCommandLock(userId, async () => {
    if (userId !== ADMIN_ID) return;

    const args = ctx.message.text.split(' ');
    const targetId = args[1];

    if (!targetId) return ctx.reply('Usage: /removechannel <ChannelID>');

    const initialLength = savedChannels.length;
    savedChannels = savedChannels.filter(ch => ch.id !== targetId);
    saveSavedChannels();

    if (savedChannels.length < initialLength) {
      ctx.reply(`✅ Channel ${targetId} removed.`);
    } else {
      ctx.reply(`❌ Channel ID not found.`);
    }
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function callbackQueryHandler(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  
  const result = await withCommandLock(userId, async () => {
    if (data.startsWith("platform:")) {
      const platformKey = data.split(":")[1];
      const selectedUrl = PLATFORMS[platformKey];
      
      if (selectedUrl) {
        if (!userTemp[userId]) userTemp[userId] = {};
        userTemp[userId].platformUrl = selectedUrl;
        userTemp[userId].platformName = platformKey;
        
        await sendMessageWithRetry(ctx, 
          `✅ Selected: ${platformKey}\n` +
          `🔰 အောက်မှာပြထားသည့်အတိုင်း Login ၀င်ပါ \n\n` +
          `📱 Phone Number\n` +
          `📱 Password`
        );
      } else {
        await sendMessageWithRetry(ctx, "❌ Invalid Platform");
      }
      await ctx.deleteMessage();
      return;
    }
    
    if (!await checkUserAuthorized(ctx)) {
      return;
    }
    
    if (data.startsWith("strategy:")) {
      const strategyData = data.split(":");
      const strategy = strategyData[1]; 
      
      if (strategy === "CHANNEL_SIGNAL" && strategyData[2]) {
        userSettings[userId].strategy = "CHANNEL_SIGNAL";
        userSettings[userId].target_channel_id = strategyData[2]; 
        
        const chName = savedChannels.find(ch => ch.id === strategyData[2])?.name || "Unknown";
        await sendMessageWithRetry(ctx, `Strategy: 📡 Copying form ${chName}`, makeMainKeyboard(true));
      } 
      else {
        userSettings[userId].strategy = strategy;
        delete userSettings[userId].target_channel_id;
        
        if (strategy === "BS_ORDER") {
          userState[userId] = { state: "INPUT_BS_PATTERN" };
          await sendMessageWithRetry(ctx, "Please enter your BS pattern (e.g., BSBSSBBS):");
        } else if (strategy === "CHAT_GPT") {
          await sendMessageWithRetry(ctx, `Strategy: Chat GPT Pattern Recognition`, makeMainKeyboard(true));
        } else if (strategy === "COLOR_TREND") {
          await sendMessageWithRetry(ctx, `Strategy: Color Trend`, makeMainKeyboard(true));
        } else if (strategy === "TREND_FOLLOW") {
          userState[userId] = { state: "INPUT_BS_WAIT_COUNT" };
          await sendMessageWithRetry(ctx, "Select BS/SB Wait Count:", makeNumberPadKeyboard());
        }
      }
      saveUserSettings();
      await ctx.deleteMessage();
    } else if (data.startsWith("bet_type:")) {
      const betType = data.split(":")[1];
      userSettings[userId].bet_type = betType;
      saveUserSettings();
      
      if (betType === "COLOR") {
        userSettings[userId].strategy = "COLOR_TREND";
      } else {
        userSettings[userId].strategy = "CHANNEL_SIGNAL";
      }
      
      await sendMessageWithRetry(ctx, `Bet Type: ${betType === "COLOR" ? "Color" : "Big/Small"}`, makeMainKeyboard(true));
      await ctx.deleteMessage();
    } else if (data.startsWith("number:")) {
      const number = parseInt(data.split(":")[1]);
      const currentState = userState[userId]?.state;
      
      if (currentState === "INPUT_BS_WAIT_COUNT") {
        userSettings[userId].bs_wait_count = number;
        saveUserSettings();
        await sendMessageWithRetry(ctx, `BS/SB Wait Count: ${number}`, makeMainKeyboard(true));
        delete userState[userId];
      }
      await ctx.deleteMessage();
    } else if (data.startsWith("betting_strategy:")) {
      const bettingStrategy = data.split(":")[1];
      userSettings[userId].betting_strategy = bettingStrategy;
      
      userSettings[userId].martin_index = 0;
      userSettings[userId].dalembert_units = 1;
      userSettings[userId].consecutive_losses = 0;
      userSettings[userId].skip_betting = false;
      userSettings[userId].custom_index = 0;
      saveUserSettings();
      
      await sendMessageWithRetry(ctx, `Betting Strategy: ${bettingStrategy}`, makeMainKeyboard(true));
      await ctx.deleteMessage();
    } else if (data.startsWith("game_type:")) {
      const gameType = data.split(":")[1];
      userSettings[userId].game_type = gameType;
      
      if (gameType === "WINGO30S") {
        if (!["BS_ORDER", "TREND_FOLLOW", "CHAT_GPT", "CHANNEL_SIGNAL"].includes(userSettings[userId].strategy)) {
          userSettings[userId].strategy = "CHANNEL_SIGNAL";
        }
      } else if (gameType === "TRX") {
        if (["TREND_FOLLOW"].includes(userSettings[userId].strategy)) {
          userSettings[userId].strategy = "CHANNEL_SIGNAL";
        }
      }
      
      saveUserSettings();
      await sendMessageWithRetry(ctx, `Game Type: ${gameType}`, makeMainKeyboard(true));
      await ctx.deleteMessage();
    } else if (data.startsWith("entry_layer:")) {
      const layerValue = parseInt(data.split(":")[1]);
      userSettings[userId].layer_limit = layerValue;
    
      if (layerValue === 2) {
        userSettings[userId].entry_layer_state = { 
          waiting_for_loses: true, 
          consecutive_loses: 0,
          required_loses: 1,
          real_betting_started: false
        };
      } else if (layerValue === 3) {
        userSettings[userId].entry_layer_state = { 
          waiting_for_loses: true, 
          consecutive_loses: 0,
          required_loses: 2,
          real_betting_started: false
        };
      } else if (layerValue >= 4 && layerValue <= 9) {
        userSettings[userId].entry_layer_state = { 
          waiting_for_loses: true, 
          consecutive_loses: 0,
          required_loses: layerValue - 1,
          real_betting_started: false
        };
      }
      saveUserSettings();
      
      let description = "";
      if (layerValue === 1) {
        description = "Bet immediately according to strategy";
      } else if (layerValue === 2) {
        description = "Wait for 1 consecutive loss before real betting";
      } else if (layerValue === 3) {
        description = "Wait for 2 consecutive losses before real betting";
      } else if (layerValue >= 4 && layerValue <= 9) {
        description = `Wait for ${layerValue - 1} consecutive losses before real betting`;
      }
      
      await sendMessageWithRetry(ctx, `Entry Layer : ${layerValue} (${description})`, makeMainKeyboard(true));
      await ctx.deleteMessage();
    } else if (data.startsWith("sl_layer:")) {
      const slValue = parseInt(data.split(":")[1]);
      userSettings[userId].sl_layer = slValue > 0 ? slValue : null;
      userSettings[userId].consecutive_losses = 0;
      userSettings[userId].skip_betting = false;
      
      userSettings[userId].martin_index = userSettings[userId].original_martin_index || 0;
      userSettings[userId].dalembert_units = userSettings[userId].original_dalembert_units || 1;
      userSettings[userId].custom_index = userSettings[userId].original_custom_index || 0;
      
      delete userSLSkipWaitingForWin[userId];
      userShouldSkipNext[userId] = false;
      
      saveUserSettings();
      
      let description = "";
      if (slValue === 0) {
        description = "Disabled";
      } else {
        description = `Skip after ${slValue} consecutive losses`;
      }
      
      await sendMessageWithRetry(ctx, `SL Layer : ${slValue} (${description})`, makeMainKeyboard(true));
      await ctx.deleteMessage();
    } else if (data.startsWith("mode:")) {
      const mode = data.split(":")[1];
      const settings = userSettings[userId];
      
      if (mode === "virtual") {
        settings.virtual_mode = true;
        if (!userStats[userId]) {
          userStats[userId] = {};
        }
        if (userStats[userId].virtual_balance === undefined) {
          userStats[userId].virtual_balance = VIRTUAL_BALANCE;
        }
        saveUserSettings();
        await sendMessageWithRetry(ctx, `🖥️ Switched to Virtual Mode (${VIRTUAL_BALANCE} Ks)`, makeMainKeyboard(true));
      } else if (mode === "real") {
        settings.virtual_mode = false;
        saveUserSettings();
        await sendMessageWithRetry(ctx, "💵 Switched to Real Mode", makeMainKeyboard(true));
      }
      
      await ctx.deleteMessage();
    } else if (data.startsWith("schedule:")) {
      const action = data.split(":")[1];
      
      if (action === "start_time") {
        userState[userId] = { 
          state: "INPUT_SCHEDULE_TIME",
          time_type: "start"
        };
        
        await sendMessageWithRetry(ctx, 
          "START TIMES (HH:MM):\n" +
          "Example: 04:20, 05:20",
          makeMainKeyboard(true)
        );
        
      } else if (action === "stop_time") {
        userState[userId] = { 
          state: "INPUT_SCHEDULE_TIME",
          time_type: "stop"
        };
        
        await sendMessageWithRetry(ctx, 
          "STOP TIMES (HH:MM):\n" +
          "Example: 05:00, 06:00",
          makeMainKeyboard(true)
        );
        
      } else if (action === "reset_all") {
        resetScheduleSettings(userId);
        await sendMessageWithRetry(ctx, 
          "✅ All times have been reset! ",
          makeMainKeyboard(true)
        );
      }
      
      await ctx.deleteMessage();
    }
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function textMessageHandler(ctx) {
  const messageObj = ctx.message || ctx.channelPost;
  if (!messageObj || !messageObj.text) return;

  const userId = ctx.from ? ctx.from.id : null;
  const rawText = messageObj.text;

  if (ctx.channelPost) {
    await channelPostHandler(ctx);
    return;
  }

  const text = normalizeText(rawText);
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  const result = await withCommandLock(userId, async () => {
    if (rawText.includes("🔐 Login")) {
      if (userSessions[userId]) {
        logoutUser(userId);
        await sendMessageWithRetry(ctx, "🔓 Existing session logged out. Please select platform again.");
      }
      
      await sendMessageWithRetry(ctx, "🌐 Please Select Game :", makePlatformSelectionKeyboard());
      return;
    }
    
    if (rawText.includes("🏁 Info")) {
      await showUserStats(ctx, userId);
      return;
    }
    
    if (rawText.includes("🎲 WINGO/TRX")) {
      await sendMessageWithRetry(ctx, "Select Game Type:", makeGameTypeKeyboard());
      return;
    }
    
    if (rawText.includes("🧠 Strategy")) {
      const settings = userSettings[userId] || {};
      const gameType = settings.game_type || "TRX";
   
      if (gameType === "TRX") {
        await sendMessageWithRetry(ctx, "📝Choose Strategy📝", makeStrategyKeyboard(userId));
      } else if (gameType === "WINGO30S") {
        await sendMessageWithRetry(ctx, "📝Choose Strategy📝", makeWingoStrategyKeyboard());
      } else {
        await sendMessageWithRetry(ctx, "📝Choose Strategy📝", makeStrategyKeyboard(userId));
      }
      return;
    }
    
    if (rawText.includes("🎯 Bet Type")) {
      await sendMessageWithRetry(ctx, "Select Bet Type:", makeBetTypeKeyboard());
      return;
    }
    
    if (rawText.includes("⚔️ Start")) {
      const settings = userSettings[userId] || {};
      
      if (!settings.bet_sizes) {
        await sendMessageWithRetry(ctx, "Bot is not working at the moment because some Bot Settings are still to be configured.!", makeMainKeyboard(true));
        return;
      }
      
      if (settings.strategy === "BS_ORDER" && !settings.pattern) {
        settings.pattern = DEFAULT_BS_ORDER;
        settings.pattern_index = 0;
        saveUserSettings();
        await sendMessageWithRetry(ctx, `No BS order provided. Using default: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true));
      }
      
      if (settings.betting_strategy === "D'Alembert" && settings.bet_sizes.length > 1) {
        await sendMessageWithRetry(ctx, 
          "❌ D'Alembert strategy အသုံးပြုထားခြင်းကြောင့်Bet Size ကို တစ်ခုသာရေးပေးရန်လိုအပ်ပါသည်\n" +
          "❌ Please set Bet Size again with only one number.",
          makeMainKeyboard(true)
        );
        return;
      }
      
      if (settings.running) {
        await sendMessageWithRetry(ctx, "ကျေးဇူးပြု၍ STOP ပြီးမှ START ပြန်နှိပ်ါ", makeMainKeyboard(true));
        return;
      }
     
   
      if (settings.profit_stop_active) {
        settings.profit_stop_active = false;
        logging.info(`User ${userId} - Reset profit_stop_active flag on manual start`);
      }
     
      const hasTimeSettings = settings.schedule_enabled && 
                             settings.schedule_start_times && 
                             settings.schedule_start_times.length > 0 &&
                             settings.schedule_stop_times && 
                             settings.schedule_stop_times.length > 0;
      
      if (hasTimeSettings) {
        settings.manual_start_with_schedule = true;
        settings.profit_stop_active = false; 

        const now = getMyanmarTime();
        const currentTimeStr = formatTime(now);
        const currentTotalMinutes = timeToMinutes(currentTimeStr);
        
        let isInWindow = false;
        const startTimes = settings.schedule_start_times;
        const stopTimes = settings.schedule_stop_times;

        for (let i = 0; i < Math.min(startTimes.length, stopTimes.length); i++) {
          const startMins = timeToMinutes(startTimes[i]);
          const stopMins = timeToMinutes(stopTimes[i]);
          const inThisWindow = (startMins < stopMins) 
              ? (currentTotalMinutes >= startMins && currentTotalMinutes < stopMins)
              : (currentTotalMinutes >= startMins || currentTotalMinutes < stopMins);
          if (inThisWindow) {
             isInWindow = true;
             break;
          }
        }

        if (!isInWindow) {
          await sendMessageWithRetry(ctx, 
            `✅ <b>TIMER SETTING ACTIVATED</b>\n` +
            
            `⚠️ <b>စတင်မည့်အချိန်ကို စောင့်မျှော်လျက်...</b>.`,
            makeMainKeyboard(true)
          );
          saveUserSettings();
          return; 
        } else {
           await sendMessageWithRetry(ctx, `✅ <b>TIMER SETTING ACTIVATED</b>\n⏰ <b>လက်ရှိအချိန်တိုင်းကိရိယာ။ ယခုစတင်ပါသည်...</b>`, makeMainKeyboard(true));
        }

      } else {
        settings.manual_start_with_schedule = false;
        await sendMessageWithRetry(ctx, `✅ <b>MANUAL START</b>\n⏰ <b>No Timer Setting Active</b>`, makeMainKeyboard(true));
      }
      
      settings.running = true;
      settings.consecutive_errors = 0;
     
      const entryLayer = settings.layer_limit || 1;
      if (entryLayer === 2) {
        settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0, required_loses: 1, real_betting_started: false };
      } else if (entryLayer === 3) {
        settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0, required_loses: 2, real_betting_started: false };
      } else if (entryLayer >= 4 && entryLayer <= 9) {
        settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0, required_loses: entryLayer - 1, real_betting_started: false };
      }
      
      if (settings.strategy === "TREND_FOLLOW" || settings.strategy === "CHAT_GPT" || settings.strategy === "CHANNEL_SIGNAL") {
        userResultHistory[userId] = [];
        settings.bs_wait_active = false;
        settings.bs_wait_remaining = 0;
      }
      
      delete userSkippedBets[userId];
      userShouldSkipNext[userId] = false;
      delete userSLSkipWaitingForWin[userId];
      delete userDelayUntil[userId]; 
      userWaitingForResult[userId] = false;
      
      bettingWorker(userId, ctx, ctx.telegram);
      return;
    }
    
    if (rawText.includes("🛡️ Stop")) {
      const settings = userSettings[userId] || {};
      
      resetScheduleSettings(userId);
      
      if (!settings.running) {
        await sendMessageWithRetry(ctx, "Bot Is Not Running! (All Timer Reset)", makeMainKeyboard(true));
        return;
      }
      
      userStopInitiated[userId] = true;
      
      settings.manual_start_with_schedule = false;
      settings.running = false;
      
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      delete userSLSkipWaitingForWin[userId];
      delete userDelayUntil[userId];
      delete settings.trend_skip_reason;
      
      resetSkipPeriods(userId);
      
      if (settings.strategy === "TREND_FOLLOW" || settings.strategy === "CHAT_GPT" || settings.strategy === "CHANNEL_SIGNAL") {
        delete userResultHistory[userId];
        settings.bs_wait_active = false;
      }
      settings.martin_index = 0;
      settings.dalembert_units = 1;
      settings.custom_index = 0;
      saveUserSettings();
      
      let totalProfit = 0;
      let balanceText = "";
      
      if (settings.virtual_mode) {
        totalProfit = (userStats[userId]?.virtual_balance || VIRTUAL_BALANCE) - VIRTUAL_BALANCE;
        balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || VIRTUAL_BALANCE).toFixed(2)} Ks\n`;
      } else {
        totalProfit = userStats[userId]?.profit || 0;
        try {
          const session = userSessions[userId];
          const finalBalance = await getBalance(session, userId);
          balanceText = `💰 Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
        } catch (error) {
          balanceText = "Final Balance: Unknown\n";
        }
      }
      
      let profitIndicator = totalProfit > 0 ? "+" : (totalProfit < 0 ? "-" : "");
      
      const message = `🚫 BOT STOPPED (Manual)\n${balanceText}💰 Total Profit: ${profitIndicator}${Math.abs(totalProfit).toFixed(2)} Ks\n⚠️ Time Setting has been reset.`;
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
      return;
    }
    
    if (rawText.includes("💣 Bet_Size")) {
      userState[userId] = { state: "INPUT_BET_SIZES" };
      await sendMessageWithRetry(ctx, "Enter Bet Size📝\n\nExample: 100-200-300", makeMainKeyboard(true));
      return;
    }
    
    if (rawText.includes("🎮 Virtual/Real Mode")) {
      await sendMessageWithRetry(ctx, "📝Select Mode📝", makeModeSelectionKeyboard());
      return;
    }
    
    if (rawText.includes("🏹 Profit Target")) {
      userState[userId] = { state: "INPUT_PROFIT_TARGET" };
      await sendMessageWithRetry(ctx, "Enter Profit Target📝\n\nExample: 100000", makeMainKeyboard(true));
      return;
    }
    
    if (rawText.includes("🔥 Stop Loss Limit")) {
      userState[userId] = { state: "INPUT_STOP_LIMIT" };
      await sendMessageWithRetry(ctx, "Enter Stop Loss Limit📝\n\nExample: 100000", makeMainKeyboard(true));
      return;
    }
    
    if (rawText.includes("🔄 Entry Layer")) {
      await sendMessageWithRetry(ctx, "📝Select Entry Layer📝", makeEntryLayerKeyboard());
      return;
    }
    
    if (rawText.includes("💥 Bet_SL")) {
      await sendMessageWithRetry(ctx, "📝Select SL Layer📝", makeSLLayerKeyboard());
      return;
    }
    
    if (rawText.includes("🚀 Anti/Martingale")) {
      await sendMessageWithRetry(ctx, "📝Betting Strategy📝", makeBettingStrategyKeyboard());
      return;
    }
    
    if (rawText.includes("⏰ Time Settings")) {
      await sendMessageWithRetry(ctx, 
        "⏰ Time Settings\n\n" +
        "Select an option to set or reset:",
        makeScheduleOptionsKeyboard()
      );
      return;
    }
    
    if (lines.length >= 2 && 
        lines[0].match(/^9\d{9,11}$/) &&
        lines[1].length >= 6) { 
      
      const username = lines[0];
      const password = lines[1];
      const selectedUrl = userTemp[userId]?.platformUrl || DEFAULT_BASE_URL;
      const platformName = userTemp[userId]?.platformName || "Default";

      await sendMessageWithRetry(ctx, `Checking Login on ${platformName}...`);
      
      const { response: res, session } = await loginRequest(username, password, selectedUrl);
      
      if (session) {
        const userInfo = await getUserInfo(session, userId);
        if (userInfo && userInfo.user_id) {
          const gameUserId = userInfo.user_id;
          if (!allowed777bigwinIds.has(gameUserId)) {
            await sendMessageWithRetry(ctx, "ခွင့်ပြုချက်မရှိသေးပါ။အသုံးပြုသူ၏ GAME ID ကို ခွင့်ပြုရန် @zawzawaung700000ကို ဆက်သွယ်ပါ။.", makeMainKeyboard(false));
            return;
          }
          
          const existingSettings = userSettings[userId];
          
          userSessions[userId] = session;
          userGameInfo[userId] = userInfo;
          
          userLoginCredentials[userId] = { 
            phone: username, 
            password: password,
            apiUrl: selectedUrl 
          };
          
          saveUserCredentials();

          userSessionExpiry[userId] = Date.now() + (6 * 60 * 60 * 1000);
          
          if (!existingSettings) {
            userSettings[userId] = getDefaultUserSettings();
          } else {
            userSettings[userId] = {
              ...existingSettings,
              schedule_enabled: false,
              schedule_start_times: [],
              schedule_stop_times: [],
              schedule_restart_time: null,
              manual_start_with_schedule: false,
              profit_stop_active: false
            };
          }
          
          const balance = await getBalance(session, userId);
          
          if (!userStats[userId]) {
            userStats[userId] = { start_balance: parseFloat(balance || 0), profit: 0.0 };
          } else {
            userStats[userId].start_balance = parseFloat(balance || 0);
            userStats[userId].profit = 0.0;
          }
          
          const balanceDisplay = balance !== null ? balance : 0.0;
          await sendMessageWithRetry(ctx, `✅ Login Successful (${platformName})\n🆔 User ID: ${userInfo.user_id},\n💶 Balance: ${balanceDisplay} Ks`, makeMainKeyboard(true));
           
          await showUserStats(ctx, userId);
        } else {
          await sendMessageWithRetry(ctx, "Login failed: Could not get user info", makeMainKeyboard(false));
        }
      } else {
        const msg = res.msg || "Login မအောင်မြင်ပါ";
        await sendMessageWithRetry(ctx, `Login Error: ${msg}`, makeMainKeyboard(false));
      }
      
      delete userTemp[userId];
      return;
    }
    
    const command = text.toUpperCase()
      .replace(/_/g, '')
      .replace(/ /g, '')
      .replace(/\//g, '')
      .replace(/\(/g, '')
      .replace(/\)/g, '')
      .replace(/⚔️/g, 'Start')
      .replace(/🛡️/g, 'Stop')
      .replace(/💣/g, 'Bet_Size')
      .replace(/🎮/g, 'Virtual/Real Mode')
      .replace(/🏹/g, 'Profit Target')
      .replace(/🔥/g, 'Stop Loss Limit')
      .replace(/🧠/g, 'Strategy')
      .replace(/🔄/g, 'Entry Layer')
      .replace(/💥/g, 'Bet_SL')
      .replace(/🚀/g, 'Anti/Martingale')
      .replace(/🏁/g, 'info')
      .replace(/ℹ️/g, 'INFO')
      .replace(/🖥️/g, 'PC')
      .replace(/🎯/g, 'TARGET')
      .replace(/🛑/g, 'STOP_SIGN')
      .replace(/⛔/g, 'NO_ENTRY')
      .replace(/🔐/g, 'Login')
      .replace(/💰/g, 'MONEY')
      .replace(/📝/g, 'NOTE')
      .replace(/▶️/g, 'PLAY')
      .replace(/⏹️/g, 'STOP_BUTTON')
      .replace(/📡/g, 'SIGNAL');
      
    if (command === "LOGIN" || (lines.length > 0 && lines[0].toLowerCase() === "login")) {
      if (userSessions[userId]) {
        logoutUser(userId);
        await sendMessageWithRetry(ctx, "🔓 Existing session logged out. Please select Game again.");
      }
      
      if (lines.length >= 3 && lines[0].toLowerCase() === "login") {
        const username = lines[1];
        const password = lines[2];
        const selectedUrl = userTemp[userId]?.platformUrl || DEFAULT_BASE_URL;
        const platformName = userTemp[userId]?.platformName || "Default";
        
        await sendMessageWithRetry(ctx, `Checking Login on ${platformName}...`);
        const { response: res, session } = await loginRequest(username, password, selectedUrl);
        if (session) {
          const userInfo = await getUserInfo(session, userId);
          if (userInfo && userInfo.user_id) {
            const gameUserId = userInfo.user_id;
            if (!allowed777bigwinIds.has(gameUserId)) {
              await sendMessageWithRetry(ctx, "ခွင့်ပြုချက်မရှိသေးပါ။အသုံးပြုသူ၏ GAME ID ကို ခွင့်ပြုရန် @zawzawaung700000ကို ဆက်သွယ်ပါ။.", makeMainKeyboard(false));
              return;
            }
            
            const existingSettings = userSettings[userId];
            
            userSessions[userId] = session;
            userGameInfo[userId] = userInfo;
            
            userLoginCredentials[userId] = { 
              phone: username, 
              password: password,
              apiUrl: selectedUrl 
            };
            
            saveUserCredentials(); 

            userSessionExpiry[userId] = Date.now() + (6 * 60 * 60 * 1000);
            
            if (!existingSettings) {
              userSettings[userId] = getDefaultUserSettings();
            } else {
              userSettings[userId] = {
                ...existingSettings,
                schedule_enabled: false,
                schedule_start_times: [],
                schedule_stop_times: [],
                schedule_restart_time: null,
                manual_start_with_schedule: false
              };
            }
            
            const balance = await getBalance(session, userId);
            
            if (!userStats[userId]) {
              userStats[userId] = { start_balance: parseFloat(balance || 0), profit: 0.0 };
            } else {
              userStats[userId].start_balance = parseFloat(balance || 0);
              userStats[userId].profit = 0.0;
            }
            
            const balanceDisplay = balance !== null ? balance : 0.0;
            await sendMessageWithRetry(ctx, `✅ Login Successful (${platformName})\n🆔 User ID: ${userInfo.user_id},\n💶 Balance: ${balanceDisplay} Ks`, makeMainKeyboard(true));
           
            await showUserStats(ctx, userId);
          } else {
            await sendMessageWithRetry(ctx, "Login failed: Could not get user info", makeMainKeyboard(false));
          }
        } else {
          const msg = res.msg || "Login မအောင်မြင်ပါ";
          await sendMessageWithRetry(ctx, `Login Error: ${msg}`, makeMainKeyboard(false));
        }
        delete userState[userId];
        delete userTemp[userId];
        return;
      }
      
      await sendMessageWithRetry(ctx, "🌐 Please Select Game :", makePlatformSelectionKeyboard());
      return;
    }
    
    if (!await checkUserAuthorized(ctx) && command !== "LOGIN") {
      return;
    }
    
    try {
      const currentState = userState[userId]?.state;
      if (currentState === "INPUT_BET_SIZES") {
        let betSizes = [];
        if (lines.length === 1 && lines[0].includes('-')) {
          betSizes = lines[0].split('-')
            .map(s => s.trim())
            .filter(s => s.match(/^\d+$/))
            .map(Number);
        } else {
          betSizes = lines.filter(s => s.match(/^\d+$/)).map(Number);
        }
        
        if (betSizes.length === 0) {
          throw new Error("No valid numbers");
        }
        
        const settings = userSettings[userId];
        if (settings.betting_strategy === "D'Alembert" && betSizes.length > 1) {
          await sendMessageWithRetry(ctx, 
            "❌ D'Alembert strategy အသုံးပြုထားခြင်းကြောင့်Bet Size ကို တစ်ခုသာရေးပေးရန်လိုအပ်ပါသည်\n" +
            "❌ Please enter only one number for unit size.\n" +
            "Example:\n100",
            makeMainKeyboard(true)
          );
          return;
        }
        
        userSettings[userId].bet_sizes = betSizes;
        userSettings[userId].dalembert_units = 1;
        userSettings[userId].martin_index = 0;
        userSettings[userId].custom_index = 0;
        saveUserSettings();
        
        let message = `BET SIZE: ${betSizes.join('-')} Ks`;
        if (settings.betting_strategy === "D'Alembert") {
          message += `\n📝 D'Alembert Bet Size : ${betSizes[0]} Ks`;
        }
        
        await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
        delete userState[userId];
      } else if (currentState === "INPUT_BS_PATTERN") {
        const pattern = text.toUpperCase();
        if (pattern && pattern.split('').every(c => c === 'B' || c === 'S')) {
          userSettings[userId].pattern = pattern;
          userSettings[userId].pattern_index = 0;
          saveUserSettings();
          await sendMessageWithRetry(ctx, `BS Pattern: ${pattern}`, makeMainKeyboard(true));
          delete userState[userId];
        } else {
          await sendMessageWithRetry(ctx, "Invalid pattern. Please use only B and S. Example: BSBSSB", makeMainKeyboard(true));
        }
      } else if (currentState === "INPUT_PROFIT_TARGET") {
        const target = parseFloat(lines.length >= 2 ? lines[1] : text);
        if (isNaN(target) || target <= 0) {
          throw new Error("Invalid profit target");
        }
        userSettings[userId].target_profit = target;
        saveUserSettings();
        await sendMessageWithRetry(ctx, `PROFIT TARGET: ${target} Ks`, makeMainKeyboard(true));
        delete userState[userId];
      } else if (currentState === "INPUT_STOP_LIMIT") {
        const stopLoss = parseFloat(lines.length >= 2 ? lines[1] : text);
        if (isNaN(stopLoss) || stopLoss <= 0) {
          throw new Error("Invalid stop loss");
        }
        userSettings[userId].stop_loss = stopLoss;
        saveUserSettings();
        await sendMessageWithRetry(ctx, `STOP LOSS LIMIT: ${stopLoss} Ks`, makeMainKeyboard(true));
        delete userState[userId];
      } else if (currentState === "INPUT_SCHEDULE_TIME") {
        const timeType = userState[userId].time_type;
        const timeInputs = parseTimeInput(text);
        
        if (!timeInputs || timeInputs.length === 0) {
          await sendMessageWithRetry(ctx, 
            "❌ Invalid time format!\n" +
            "Please enter times in HH:MM format\n" +
            "Example: 04:20, 05:20, 06:00, 07:30, 08:50",
            makeMainKeyboard(true)
          );
          return;
        }
       
        if (!userSettings[userId]) {
          userSettings[userId] = getDefaultUserSettings();
        }
        
        let message = "";
        const timesFormatted = timeInputs.map(t => t.formatted);
        
        if (timeType === "start") {
          userSettings[userId].schedule_start_times = timesFormatted;
          userState[userId] = { 
            state: "INPUT_SCHEDULE_TIME",
            time_type: "stop"
          };
          
          await sendMessageWithRetry(ctx, 
            `✅ StartTimes => ${timesFormatted.join(', ')}\n\n` +
            "NOW ENTER STOP TIMES (HH:MM):\n" +
            "Example: 05:00, 06:00, 07:00, 08:30",
            makeMainKeyboard(true)
          );
          return;
          
        } else if (timeType === "stop") {
          const startTimes = userSettings[userId].schedule_start_times || [];
          
          if (startTimes.length !== timesFormatted.length) {
            await sendMessageWithRetry(ctx, 
              `❌ Number of stop times (${timesFormatted.length}) doesn't match start times (${startTimes.length})\n\n` +
              "ကျေးဇူးပြု၍ စတင်ချိန်များကဲ့သို့ ရပ်နားချိန်အရေအတွက် တူညီပါမည်။",
              makeMainKeyboard(true)
            );
            return;
          }
          
          userSettings[userId].schedule_stop_times = timesFormatted;
          message = `✅ StopTimes => ${timesFormatted.join(', ')}\n\n`;

          userSettings[userId].schedule_enabled = true;
          saveUserSettings();

          delete userState[userId];

          const currentSettings = userSettings[userId];
          const displayStartTimes = currentSettings.schedule_start_times || [];
          const displayStopTimes = currentSettings.schedule_stop_times || [];

          message += "⏰ TIMES SETTINGS:\n";
          
          for (let i = 0; i < Math.min(displayStartTimes.length, displayStopTimes.length); i++) {
            message += `${i + 1}. ${formatTimeForDisplay(displayStartTimes[i])} - ${formatTimeForDisplay(displayStopTimes[i])}\n`;
          }
          
          if (displayStartTimes.length !== displayStopTimes.length) {
            message += `⚠️ သတိပေးချက်- စတင်/ရပ်နားချိန် အရေအတွက် မကိုက်ညီပါ။\n`;
          }
          
          await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
          return;
        }
      }
    } catch (error) {
      await sendMessageWithRetry(ctx, `Error: ${error.message}`, makeMainKeyboard(true));
    }
  });
  
  if (!result.success && result.message) {
    await sendMessageWithRetry(ctx, result.message);
  }
}

async function showUserStats(ctx, userId) {
  const session = userSessions[userId];
  const userInfo = userGameInfo[userId];
  if (!userInfo) {
    await sendMessageWithRetry(ctx, "Failed to get info", makeMainKeyboard(true));
    return;
  }
  
  const settings = userSettings[userId] || {};
  const betSizes = settings.bet_sizes || []
  const strategy = settings.strategy || "CHANNEL_SIGNAL";
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const gameType = settings.game_type || "TRX";
  const betType = settings.bet_type || "BS";
  const virtualMode = settings.virtual_mode || false;
  const profitTarget = settings.target_profit;
  const stopLoss = settings.stop_loss;
  const slLayer = settings.sl_layer;
  const layerLimit = settings.layer_limit || 1;
  const scheduleEnabled = settings.schedule_enabled || false;
  const startTimes = settings.schedule_start_times || [];
  const stopTimes = settings.schedule_stop_times || [];
  const manualStartWithSchedule = settings.manual_start_with_schedule || false;
  
  let balance, totalProfit, betOrder;
  
  if (virtualMode) {
    balance = userStats[userId]?.virtual_balance || VIRTUAL_BALANCE;
    totalProfit = balance - VIRTUAL_BALANCE;
  } else {
    if (!await ensureValidSession(userId)) {
      await sendMessageWithRetry(ctx, "❌ Session expired. Please login again.", makeMainKeyboard(false));
      return;
    }
    balance = await getBalance(session, userId);
    totalProfit = userStats[userId]?.profit || 0;
  }
  
  let profitIndicator = "";
  if (totalProfit > 0) {
    profitIndicator = "+";
  } else if (totalProfit < 0) {
    profitIndicator = "-";
  } else {
    profitIndicator = "";
  }
  
  if (strategy === "CHAT_GPT") {
    betOrder = "Chat GPT";
  } else if (strategy === "TREND_FOLLOW") {
    betOrder = "TrendFollow V1";
    if (settings.bs_wait_count > 0) {
      betOrder += `=>BS/SBWait: ${settings.bs_wait_count}`;
    }
    if (userResultHistory[userId] && userResultHistory[userId].length > 0) {
      betOrder += `\nHistory: ${userResultHistory[userId].slice(-5).join('')}`;
    }
    if (settings.bs_wait_active) {
      betOrder += `\n⏳ Wait Active (${settings.bs_wait_remaining} remaining)`;
    }
  } else if (strategy === "BS_ORDER") {
    betOrder = settings.pattern || "BS-Order";
  } else if (strategy === "COLOR_TREND") {
    betOrder = "Color Trend";
  } else if (strategy === "CHANNEL_SIGNAL") {
    const channelName = savedChannels.find(ch => ch.id === settings.target_channel_id)?.name || "Unknown";
    betOrder = `Channel Signal (${channelName})`;
  } else {
    betOrder = strategy;
  }
  
  let bettingState = "";
  if (bettingStrategy === "Martingale") {
    const currentIndex = settings.martin_index || 0;
    bettingState = `Current Index: ${currentIndex}/${betSizes.length - 1}`;
  } else if (bettingStrategy === "Anti-Martingale") {
    const currentIndex = settings.martin_index || 0;
    bettingState = `Current Index: ${currentIndex}/${betSizes.length - 1}`;
  } else if (bettingStrategy === "D'Alembert") {
    const currentUnits = settings.dalembert_units || 1;
    bettingState = `Current Units: ${currentUnits}`;
  } else if (bettingStrategy === "Custom") {
    const currentIndex = settings.custom_index || 0;
    bettingState = `Current Index: ${currentIndex}/${betSizes.length - 1}`;
  }
  
  let entryLayerDesc = "";
  if (layerLimit === 1) {
    entryLayerDesc = "Bet immediately according to strategy";
  } else if (layerLimit === 2) {
    entryLayerDesc = "Wait for 1 consecutive loss before real betting";
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
      entryLayerDesc += ` (Currently waiting for ${settings.entry_layer_state.consecutive_loses || 0}/1)`;
    }
  } else if (layerLimit === 3) {
    entryLayerDesc = "Wait for 2 consecutive losses before real betting";
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
      entryLayerDesc += ` (Currently waiting for ${settings.entry_layer_state.consecutive_loses || 0}/2)`;
    }
  } else if (layerLimit >= 4 && layerLimit <= 9) {
    entryLayerDesc = `Wait for ${layerLimit - 1} consecutive losses before real betting`;
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
      entryLayerDesc += ` (Currently waiting for ${settings.entry_layer_state.consecutive_loses || 0}/${layerLimit - 1})`;
    }
  }
  
  let slStatus = "";
  if (userSLSkipWaitingForWin[userId]) {
    slStatus = `\n🔴 SL Status: Waiting for Skip Win`;
  } else if (settings.consecutive_losses > 0) {
    slStatus = `\n🔴 Consecutive Losses: ${settings.consecutive_losses}/${slLayer || 0}`;
  }
  
  const modeText = virtualMode ? " Virtual Mode" : " Real Mode";
  const betTypeText = betType === "COLOR" ? "Color" : "Big/Small";

  let scheduleInfo = "";
  const hasTimeSettings = scheduleEnabled && startTimes.length > 0 && stopTimes.length > 0;
  
  if (hasTimeSettings) {
    scheduleInfo = "⏰ TIMER SETTING INFO \n";

    for (let i = 0; i < Math.min(startTimes.length, stopTimes.length); i++) {
      scheduleInfo += `🕐 ${formatTimeForDisplay(startTimes[i])} - ${formatTimeForDisplay(stopTimes[i])}\n`;
    }
    
    if (manualStartWithSchedule) {
      scheduleInfo += `✅ Auto TIMER : ACTIVE\n`;
    } else {
      scheduleInfo += `❌ Auto TIMER : INACTIVE (Press START)\n`;
    }
  } else {
    scheduleInfo = `\n⏰ TIMER : Not Set`;
  }
  
  const platformName = getPlatformDisplayName(userLoginCredentials[userId]?.apiUrl || DEFAULT_BASE_URL);
  
  const infoText = 
  `🏠 ⟦ ${platformName} ⟧ ⟦ 𝐁𝐄𝐓 𝐁𝐎𝐓 ⟧ 🏠\n\n` +
  `👤 USER ID  : ${userInfo.user_id || 'N/A'}\n\n` +
  `📕 BALANCE : ${balance !== null ? balance.toFixed(2) : 'N/A'} Ks\n` +
  `📕 BALANCE TYPE : ${modeText}\n\n` +
  `📕 GAME TYPE : ${gameType}\n` +
  `📕 BET TYPE   : ${betTypeText}\n` +
  `📕 STRATEGY MODE: ${strategy}\n\n` +
  `📕 BETTING MODE  : ${bettingStrategy}\n` +
  `📕 BET SIZES : ${betSizes.join('-') || 'Not Set'}\n\n` +
  `📕 BET ORDER : ${betOrder}\n\n` +
  `📕 PROFIT TARGET : ${profitTarget !== undefined ? profitTarget + ' Ks' : '0 Ks'}\n` +
  `📕 STOP LOSS : ${stopLoss !== undefined ? stopLoss + ' Ks' : '0 Ks'}\n\n` +
  `📕 SL COUNT  :  ${slLayer ? slLayer + ' - SL' : '0 - SL'} \n` +
  `📕 ENTRY LAYER :  ${layerLimit} - Layer\n\n` +
  `${scheduleInfo}\n\n` +
  `📕 BOT STATUS  : ${settings.running ? '🟢 START' : '🔴 STOP'}\n\n` +
  `🌌𝙋𝙊𝙒𝙀𝙍𝙀𝘿 𝘽𝙔 𝘿𝙍𝙀𝘼𝙈 𝙎𝙔𝙎𝙏𝙀𝙈𝙈⚡️`;
  
  await sendMessageWithRetry(ctx, infoText, makeMainKeyboard(true));
}

async function getColorPrediction(userId) {
  try {
    if (!userResultHistory[userId]) {
      userResultHistory[userId] = [];
    }
    
    const history = userResultHistory[userId];
    const colorHistory = history.map(bs => {
      return bs === 'B' ? 'R' : 'G';
    });
    
    if (colorHistory.length === 0) {
      return { result: 'G', percent: '50.0' };
    }
    
    const lastColor = colorHistory[colorHistory.length - 1];
    
    const prediction = lastColor === 'G' ? 'R' : 'G';
    
    return { result: prediction, percent: '50.0' };
  } catch (error) {
    logging.error(`Error getting color prediction: ${error}`);
    return { result: 'G', percent: '50.0' };
  }
}

function main() {
  loadAllowedUsers();
  loadSavedChannels(); 
  allUsers = loadAllUsers();
  loadUserSettings(); 
  loadUserCredentials(); 
  
  const bot = new Telegraf(BOT_TOKEN);
  
  bot.start(cmdStartHandler);
  bot.command('allow', cmdAllowHandler);
  bot.command('remove', cmdRemoveHandler);
  bot.command('show', cmdShowHandler);
  bot.command('send', cmdSendHandler);
  bot.command('users', cmdUsersHandler);
  bot.command('signal', cmdSignalHandler);
  bot.command('addchannel', cmdAddChannelHandler); 
  bot.command('removechannel', cmdRemoveChannelHandler); 
  bot.on('callback_query', callbackQueryHandler);
  bot.on('text', textMessageHandler);
  bot.on('channel_post', textMessageHandler);
  
  restoreSessions(); 
  
  winLoseChecker(bot).catch(error => {
    logging.error(`Win/lose checker failed: ${error.message}`);
  });
  
  scheduleChecker(bot).catch(error => {
    logging.error(`Timer checker failed: ${error.message}`);
  });

  bot.launch().then(() => {
    logging.info('Bot started successfully');
    logging.info('📡 Enhanced Channel Signal System: ACTIVE');
    logging.info(`📊 Configured channel sources: ${savedChannels.length}`);
    logging.info(`⏰ 5-second delay after results: ENABLED`);
    logging.info('⏰ Schedule Checker: ACTIVE (Myanmar Time UTC+6:30)');
    logging.info('⏰ Manual Start with Schedule: ENABLED');
    logging.info('🌐 Multi-platform support: ENABLED (6Lottery, 777BigWin, CKLottery)');
    logging.info('🔓 Auto-logout on Login button click: ENABLED');
    logging.info('♻️ Auto-login for saved users: ENABLED');
    logging.info('🔄 Auto-login retry for expired sessions: ENABLED');
    logging.info('🚫 Duplicate betting prevention: ENABLED');
  }).catch(error => {
    logging.error(`Bot failed to start: ${error.message}`);
  });
  
  process.on('uncaughtException', (error) => {
    logging.error(`Uncaught Exception: ${error.message}`);
    logging.error(error.stack);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logging.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  });
 
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

if (require.main === module) {
  main();
}