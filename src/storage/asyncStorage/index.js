/* eslint-disable no-underscore-dangle */
/**
 * =======================================================================================
 * ==================== STILL IN PROGRESS ================================================
 * =======================================================================================
 */

import {
  convertChannelToStorable,
  convertMessageToStorable,
  convertUserToStorable,
} from './mappers';
import {
  getQueryKey,
  getChannelKey,
  getChannelMessagesKey,
  getChannelReadKey,
} from './keys';
/**
 * Local storage interface based on AsyncStorage
 */
export class AsyncLocalStorage {
  constructor(chatCLient, AsyncStorage) {
    this.chatClient = chatCLient;
    this.asyncStorage = AsyncStorage;
  }

  /**
   *
   * @param {*} query
   * @param {*} channels
   * @param {*} resync
   */
  async storeChannels(query, channels, resync) {
    if (resync) await this.asyncStorage.clear();

    const channelIds = channels.map((c) => c.id);

    const storables = {};
    channels.forEach(async (c) => await convertChannelToStorable(c, storables));

    const existingChannelIds = await this.getItem(
      `getstream:chat@${query}`,
      [],
    );

    let newChannelIds = existingChannelIds.concat(channelIds);

    newChannelIds = newChannelIds.filter(
      (item, index) => newChannelIds.indexOf(item) === index,
    );

    storables[getQueryKey(query)] = existingChannelIds.concat(channelIds);

    await this.multiSet(storables);
  }

  /**
   *
   * @param {*} key
   */
  async getItem(key, defaultValue) {
    const strValue = await this.asyncStorage.getItem(key);

    if (!strValue) return defaultValue;

    return JSON.parse(strValue);
  }

  /**
   *
   * @param {*} storables
   */
  async multiSet(storables) {
    const storablesArray = [];

    for (const key in storables) {
      storablesArray.push([key, JSON.stringify(storables[key])]);
    }

    return await this.asyncStorage.multiSet(storablesArray);
  }

  clear() {}

  /**
   *
   * @param {*} query
   */
  async queryChannels(query) {
    const channelIds = await this.getChannelIdsForQuery(query);
    if (!channelIds) return [];
    const channels = await this.getChannels(channelIds);
    const fChannels = await this.enrichChannels(channels);

    return fChannels;
  }

  /**
   *
   */
  enrichChannels = async (channels) => {
    const keysToRetrieve = [];
    channels.forEach((c) => {
      keysToRetrieve.push(c.members, c.messages, c.read);
    });

    const messagesAndMembers = await this.asyncStorage.multiGet(keysToRetrieve);
    const flattenedMessagesAndMembers = {};
    messagesAndMembers.forEach((kmPair) => {
      flattenedMessagesAndMembers[kmPair[0]] = JSON.parse(kmPair[1]);
    });
    let usersToRetrive = [];
    const storedChannels = channels.map((c) => ({
      ...c,
      messages: flattenedMessagesAndMembers[c.messages],
      members: flattenedMessagesAndMembers[c.members],
      read: flattenedMessagesAndMembers[c.read],
    }));

    storedChannels.forEach((c) => {
      c.members.forEach((m) => usersToRetrive.push(m.user));
      c.messages.forEach((m) => {
        m.mentioned_users.forEach((u) => usersToRetrive.push(u));
        m.latest_reactions.forEach((r) => usersToRetrive.push(r.user));
      });
    });

    usersToRetrive = usersToRetrive.filter(
      (item, index) => usersToRetrive.indexOf(item) === index,
    );

    const users = await this.asyncStorage.multiGet(usersToRetrive);
    const flatteneUsers = {};
    users.forEach((kuPair) => {
      flatteneUsers[kuPair[0]] = JSON.parse(kuPair[1]);
    });

    const finalChannels = storedChannels.map((c) => {
      const channel = { ...c };
      channel.members = c.members.map((m) => {
        const member = m;
        member.user = flatteneUsers[member.user];
        return member;
      });

      for (const userId in channel.read) {
        channel.read[userId].user = flatteneUsers[channel.read[userId].user];
        channel.read[userId].last_read = new Date(
          channel.read[userId].last_read,
        );
      }

      channel.messages = c.messages.map((m) => {
        const message = { ...m, attachments: [] };
        message.user = flatteneUsers[message.user];
        message.mentioned_users = m.mentioned_users.map(
          (u) => flatteneUsers[u],
        );
        message.latest_reactions = m.latest_reactions.map((r) => {
          const reaction = r;
          reaction.user = flatteneUsers[r.user];

          return reaction;
        });

        message.own_reactions = m.own_reactions.map((r) => {
          const reaction = r;
          reaction.user = flatteneUsers[r.user];

          return reaction;
        });

        return message;
      });

      const fChannel = this.chatClient.channel(c.type, c.id, {}, true);
      fChannel.data = { ...c.data };
      // eslint-disable-next-line no-underscore-dangle
      fChannel._initializeState({
        members: channel.members,
        messages: channel.messages,
        read: Object.values(channel.read),
      });

      return fChannel;
    });

    return finalChannels;
  };

  // TODO: Implement the following
  async updateChannelData() {}

  /**
   *
   * @param {*} channelId
   * @param {*} message
   */
  async insertMessageForChannel(channelId, message) {
    return await this.insertMessagesForChannel(channelId, [message]);
  }

  /**
   *
   * @param {*} channelId
   * @param {*} messages
   */
  async insertMessagesForChannel(channelId, messages) {
    const storables = {};
    const existingMessages = await this.getItem(
      getChannelMessagesKey(channelId),
    );
    let newMessages = messages.map((m) =>
      convertMessageToStorable(m, storables),
    );

    newMessages = existingMessages.concat(newMessages);

    storables[getChannelMessagesKey(channelId)] = newMessages;

    await this.multiSet(storables);
  }

  /**
   *
   * @param {*} channelId
   * @param {*} updatedMessage
   */
  async updateMessage(channelId, updatedMessage) {
    const storables = {};
    let existingMessages = await this.getItem(getChannelMessagesKey(channelId));
    existingMessages = existingMessages ? JSON.parse(existingMessages) : [];

    const newMessages = existingMessages.map((m) => {
      if (m.id !== updatedMessage.id) {
        return m;
      }

      return convertMessageToStorable(updatedMessage, storables);
    });

    storables[getChannelMessagesKey(channelId)] = newMessages;

    await this.multiSet(storables);
  }

  /**
   *
   * @param {*} channelId
   * @param {*} message
   */
  async addReactionForMessage(channelId, message) {
    await this.updateMessage(channelId, message);
  }

  /**
   *
   * @param {*} channelId
   * @param {*} message
   */
  async deleteReactionForMessage(channelId, message) {
    await this.updateMessage(channelId, message);
  }

  async addMemberToChannel() {}
  async removeMemberFromChannel() {}
  async updateMember() {}

  /**
   *
   * @param {*} channelId
   * @param {*} user
   * @param {*} lastRead
   */
  async updateReadState(channelId, user, lastRead) {
    const reads = await this.getItem(getChannelReadKey(channelId));
    const storables = {};

    if (reads[user.id]) {
      reads[user.id] = {
        last_read: lastRead,
        user: convertUserToStorable(user, storables),
      };
    }

    storables[getChannelReadKey(channelId)] = reads;
    await this.multiSet(storables);
  }

  async queryMessages() {}

  /**
   *
   * @param {*} channels
   */
  insertChannels(channels) {
    const values = [];
    channels.forEach((c) => {
      values.push([getChannelKey(c.id), JSON.stringify(c)]);
    });

    return values;
  }

  /**
   *
   * @param {*} channelIds
   */
  async getChannels(channelIds) {
    const channelIdsToRetrieveChannels = channelIds.map((i) =>
      getChannelKey(i),
    );

    const channelsValue = await this.asyncStorage.multiGet(
      channelIdsToRetrieveChannels,
    );

    return channelsValue.map((ckPair) => JSON.parse(ckPair[1]));
  }

  /**
   *
   * @param {*} channelIds
   */
  async getChannelMessages(channelIds) {
    const channelMsgsToRetrieve = channelIds.map((i) =>
      getChannelMessagesKey(i),
    );

    const channelMessagesValue = await this.asyncStorage.multiGet(
      channelMsgsToRetrieve,
    );

    const channelMessages = {};
    for (let i = 0; i < channelMessagesValue.length; i++) {
      channelMessages[channelMessagesValue[i][0]] = JSON.parse(
        channelMessagesValue[i][1],
      );
    }

    return channelMessages;
  }

  /**
   *
   * @param {*} query
   */
  async getChannelIdsForQuery(query) {
    let channelIds = await this.getItem(getQueryKey(query));

    // .log('channelIds', channelIds);
    if (!channelIds) return [];
    channelIds = channelIds.filter(
      (item, index) => channelIds.indexOf(item) === index,
    );

    return channelIds;
  }
}

// async addReactionForMessage(channelId, messageId, reaction, ownReaction) {
//   const bench = .benchmark('ADD REACTION BENCHMARK');
//   const storables = [];
//   const existingMessagesStr = await this.asyncStorage.getItem(
//     `getstream:chat@channel:${channelId}:messages`,
//   );
//   const existingMessages = existingMessagesStr
//     ? JSON.parse(existingMessagesStr)
//     : [];
//   const newMessages = existingMessages.map((m) => {
//     if (m.id !== messageId) {
//       return m;
//     }

//     const updatedMessage = m;
//     updatedMessage.latest_reactions.push(
//       convertReactionToStorable(reaction, storables),
//     );

//     if (ownReaction) {
//       updatedMessage.own_reactions.push(
//         convertReactionToStorable(reaction, storables),
//       );
//     }
// .log('updatedMessage', updatedMessage);
//     return convertMessageToStorable(updatedMessage, storables);
//   });

//   storables.push([
//     `getstream:chat@channel:${channelId}:messages`,
//     JSON.stringify(newMessages),
//   ]);
//   await this.multiSet(storables);
//   bench.stop('DONE');
// }
