import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/test/oarchat/v1.0/socket.io"
});

const dataFile = 'userData.json';
const chatFile = 'chats.json';
const messagesFile = 'messages.json';

let users = {};
let chats = {};
let messages = {};

try {
  users = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  console.log('User data loaded from file.');
} catch {
  console.error('Error loading user data');
}
try {
  chats = JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
  console.log('Chat data loaded from file.');
} catch {
  console.error('Error loading chat data');
}
try {
  messages = JSON.parse(fs.readFileSync(messagesFile, 'utf-8'));
  console.log('Messages data loaded from file.');
} catch {
  console.error('Error loading messages data');
}

function saveUserDataToFile() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(users), 'utf-8');
  } catch (err) {
    console.error('Error saving user data:', err);
  }
}
function saveChatsToFile() {
  try {
    fs.writeFileSync(chatFile, JSON.stringify(chats), 'utf-8');
  } catch (err) {
    console.error('Error saving chat data:', err);
  }
}
function saveMessagesToFile() {
  try {
    fs.writeFileSync(messagesFile, JSON.stringify(messages), 'utf-8');
  } catch (err) {
    console.error('Error saving messages data:', err);
  }
}

function isValidUserId(userId) {
  return userId !== "null" && userId !== undefined && typeof userId === 'string' && userId.trim() !== '';
}

io.on('connection', (socket) => {
  const user_id = socket.handshake.query.user_id;
  const epochDateUser = socket.handshake.query.epoch_date_users;
  const epochDateChat = socket.handshake.query.epoch_date_chat;
  const epochDateMessages = socket.handshake.query.epoch_date_messages;

  if (!isValidUserId(user_id)) {
    console.error(`Invalid user ID, disconnecting socket: ${socket.id}`);
    socket.disconnect(true);
    return;
  }

  if (users[user_id]) {
    users[user_id] = {
      ...users[user_id],
      socket_id: socket.id,
      is_online: true,
      last_online: Date.now(),
    };
    socket.broadcast.emit('notificationMessage', {
      title: 'OarChat',
      message: `User ${users[user_id].name} is now online.`,
      body: user_id
    });
    socket.broadcast.emit('user_data_update', users[user_id]);
    saveUserDataToFile();
  }

  // Send updated users since epochDateUser
  const sortedUsers = [];
  for (const userKey in users) {
    if (userKey !== user_id && users[userKey].updated_at > epochDateUser) {
      const index = sortedUsers.findIndex(user => user.updated_at > users[userKey].updated_at);
      if (index === -1) {
        sortedUsers.push(users[userKey]);
      } else {
        sortedUsers.splice(index, 0, users[userKey]);
      }
    }
  }
  sortedUsers.forEach(user => socket.emit('user_data_update', user));

  // Send updated chats since epochDateChat
  const sortedChats = [];
  for (const chatKey in chats) {
    const chat = chats[chatKey];
    if (chat.members.includes(user_id) && chat.updated_at > epochDateChat) {
      const index = sortedChats.findIndex(existingChat => existingChat.updated_at > chat.updated_at);
      if (index === -1) {
        sortedChats.push(chat);
      } else {
        sortedChats.splice(index, 0, chat);
      }
    }
  }
  sortedChats.forEach(chat => socket.emit('chat_created', chat));

  // Send updated messages since epochDateMessages
  const userChats = Object.values(chats).filter(chat => chat.members.includes(user_id));
  const userChatIds = userChats.map(chat => chat.id);
  const sortedMessages = [];

  for (const messageKey in messages) {
    if (userChatIds.includes(messageKey)) {
      const filteredMessages = messages[messageKey].filter(m => m.created_at > epochDateMessages);
      sortedMessages.push(...filteredMessages);
    }
  }
  sortedMessages.sort((a, b) => a.updated_at - b.updated_at);
  sortedMessages.forEach(message => socket.emit('new_message', message));

  socket.on('edit_user', (userData, ackCallback) => {
    const { user_id, name, email, username } = userData;
    if (!isValidUserId(user_id)) {
      ackCallback({ success: false, message: 'Invalid user ID' });
      return;
    }

    // Check for username duplicates
    for (const existingUserId in users) {
      if (users[existingUserId].username === username && existingUserId !== user_id) {
        ackCallback({ success: false, message: 'Username already exists' });
        return;
      }
    }

    if (users[user_id]) {
      Object.assign(users[user_id], {
        id: user_id,
        name,
        email,
        username,
        is_online: true,
        last_online: Date.now(),
        updated_at: Date.now(),
      });
    } else {
      users[user_id] = {
        id: user_id,
        name,
        email,
        username,
        socket_id: socket.id,
        is_online: true,
        last_online: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      socket.broadcast.emit('notificationMessage', {
        title: 'OarChat',
        message: `User ${users[user_id].name} joined OarChat.`,
        body: ""
      });
    }
    ackCallback({ success: true });
    socket.broadcast.emit('user_data_update', users[user_id]);
    saveUserDataToFile();
  });

  socket.on('user_fb_token', (data) => {
    const { user_id, fb_token } = data;
    if (!isValidUserId(user_id)) return;
    users[user_id] = { ...users[user_id], fb_token, socket_id: socket.id };
    saveUserDataToFile();
  });

  socket.on('disconnect_user', (key) => {
    const user_id = Object.keys(users).find(id => users[id].id === key.user_id);
    if (user_id) {
      users[user_id].is_online = false;
      users[user_id].last_online = Date.now();
      socket.broadcast.emit('user_data_update', users[user_id]);
      saveUserDataToFile();
    }
  });

  socket.on('validate_chat_and_save', (chatJson) => {
    const { user_ids, id, name, type } = chatJson;
    const chatExists = Object.values(chats).some(chat => {
      const membersMatch = chat.members.length === new Set(user_ids).size;
      const allUsersPresent = user_ids.every(userId => chat.members.includes(userId));
      return membersMatch && allUsersPresent;
    });
    if (chatExists) {
      socket.emit('chat_validation_response', { exists: true });
      return;
    }
    chats[id] = {
      id,
      name,
      type,
      members: user_ids,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    user_ids.forEach(userId => {
      const user = users[userId];
      socket.emit('chat_create_response', chats[id]);
      if (user) {
        io.to(user.socket_id).emit('chat_created', chats[id]);
      }
    });
    saveChatsToFile();
  });

  socket.on('send_message', (data, ack) => {
    try {
      const message = {
        id: data.id,
        content: data.content,
        chat_id: data.chat_id,
        sender_id: data.sender_id,
        recipient_id: data.recipient_id,
        recipient_type: data.recipient_type,
        created_at: data.created_at,
        status: data.status,
        type: data.type || "TEXT",
      };

      if (!messages[message.chat_id]) {
        messages[message.chat_id] = [];
      }
      messages[message.chat_id].push(message);

      if (!chats[message.chat_id]) {
        chats[message.chat_id].last_message = message.content;
      }
      saveMessagesToFile();

      if (message.recipient_type === "individual") {
        const recipientSocketId = getSocketIdByUserId(message.recipient_id);
        if (recipientSocketId) {
          io.to(recipientSocketId).emit('new_message', message);
        }
      } else if (message.recipient_type === "group") {
        const groupMembers = getGroupMembers(message.chat_id);
        groupMembers.forEach(memberId => {
          if (memberId !== message.sender_id) {
            const recipientSocketId = getSocketIdByUserId(memberId);
            if (recipientSocketId) {
              io.to(recipientSocketId).emit('new_message', message);
            }
          }
        });
      }

      if (typeof ack === 'function') {
        ack({ success: true, message: "Message delivered successfully." });
      }
    } catch (error) {
      if (typeof ack === 'function') {
        ack({ success: false, error: "Failed to deliver message." });
      }
    }
  });

  function getGroupMembers(chatId) {
    const chat = chats[chatId];
    return chat && chat.type === "group" ? chat.members : [];
  }

  function getSocketIdByUserId(userId) {
    return users[userId] ? users[userId].socket_id : null;
  }
});

// HTTP test route
app.get('/oar', (req, res) => {
  res.send('<h1>Socket.IO Server is Running</h1>');
});

export { app, server };
