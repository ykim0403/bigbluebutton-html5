import { defineMessages } from 'react-intl';
import ConnectionStatus from '/imports/api/connection-status';
import Users from '/imports/api/users';
import UsersPersistentData from '/imports/api/users-persistent-data';
import Auth from '/imports/ui/services/auth';
import Settings from '/imports/ui/services/settings';
import _ from 'lodash';
import { Session } from 'meteor/session';
import { notify } from '/imports/ui/services/notification';
import { makeCall } from '/imports/ui/services/api';

const STATS = Meteor.settings.public.stats;
const NOTIFICATION = STATS.notification;
const STATS_INTERVAL = STATS.interval;
const ROLE_MODERATOR = Meteor.settings.public.user.role_moderator;

const intlMessages = defineMessages({
  saved: {
    id: 'app.settings.save-notification.label',
    description: 'Label shown in toast when data savings are saved',
  },
  notification: {
    id: 'app.connection-status.notification',
    description: 'Label shown in toast when connection loss is detected',
  },
});

let stats = -1;
const statsDep = new Tracker.Dependency();

let statsTimeout = null;

const URL_REGEX = new RegExp(/^(http|https):\/\/[^ "]+$/);
const getHelp = () => {
  if (URL_REGEX.test(STATS.help)) return STATS.help;

  return null;
};

const getStats = () => {
  statsDep.depend();
  return STATS.level[stats];
};

const setStats = (level = -1, type = 'recovery', value = {}) => {
  if (stats !== level) {
    stats = level;
    statsDep.changed();
    addConnectionStatus(level, type, value);
  }
};

const handleStats = (level, type, value) => {
  if (level > stats) {
    setStats(level, type, value);
  }
};

const handleAudioStatsEvent = (event) => {
  const { detail } = event;
  if (detail) {
    const { loss, jitter } = detail;
    let active = false;
    // From higher to lower
    for (let i = STATS.level.length - 1; i >= 0; i--) {
      if (loss >= STATS.loss[i] || jitter >= STATS.jitter[i]) {
        active = true;
        handleStats(i, 'audio', { loss, jitter });
        break;
      }
    }

    if (active) startStatsTimeout();
  }
};

const handleSocketStatsEvent = (event) => {
  const { detail } = event;
  if (detail) {
    const { rtt } = detail;
    let active = false;
    // From higher to lower
    for (let i = STATS.level.length - 1; i >= 0; i--) {
      if (rtt >= STATS.rtt[i]) {
        active = true;
        handleStats(i, 'socket', { rtt });
        break;
      }
    }

    if (active) startStatsTimeout();
  }
};

const startStatsTimeout = () => {
  if (statsTimeout !== null) clearTimeout(statsTimeout);

  statsTimeout = setTimeout(() => {
    setStats();
  }, STATS.timeout);
};

const addConnectionStatus = (level, type, value) => {
  const status = level !== -1 ? STATS.level[level] : 'normal';

  makeCall('addConnectionStatus', status, type, value);
}

const fetchRoundTripTime = () => {
  const t0 = Date.now();
  makeCall('voidConnection').then(() => {
    const tf = Date.now();
    const rtt = tf - t0;
    const event = new CustomEvent('socketstats', { detail: { rtt } });
    window.dispatchEvent(event);
  });
};

const sortLevel = (a, b) => {
  const indexOfA = STATS.level.indexOf(a.level);
  const indexOfB = STATS.level.indexOf(b.level);

  if (indexOfA < indexOfB) return 1;
  if (indexOfA === indexOfB) return 0;
  if (indexOfA > indexOfB) return -1;
};

const sortOffline = (a, b) => {
  if (a.offline && !b.offline) return 1;
  if (a.offline === b.offline) return 0;
  if (!a.offline && b.offline) return -1;
};

const getMyConnectionStatus = () => {
  const myConnectionStatus = ConnectionStatus.findOne(
    {
      meetingId: Auth.meetingID,
      userId: Auth.userID,
    },
    {
      fields:
      {
        level: 1,
        timestamp: 1,
      },
    },
  );

  const me = Users.findOne(
    {
      meetingId: Auth.meetingID,
      userId: Auth.userID,
    },
    {
      fields:
      {
        avatar: 1,
        color: 1,
      },
    },
  );

  if (myConnectionStatus) {
    return [{
      name: Auth.fullname,
      avatar: me.avatar,
      offline: false,
      you: true,
      moderator: false,
      color: me.color,
      level: myConnectionStatus.level,
      timestamp: myConnectionStatus.timestamp,
    }];
  }

  return [];
};

const getConnectionStatus = () => {
  if (!isModerator()) return getMyConnectionStatus();

  const connectionStatus = ConnectionStatus.find(
    { meetingId: Auth.meetingID },
  ).fetch().map((status) => {
    const {
      userId,
      level,
      timestamp,
    } = status;

    return {
      userId,
      level,
      timestamp,
    };
  });

  return UsersPersistentData.find(
    { meetingId: Auth.meetingID },
    {
      fields:
      {
        userId: 1,
        name: 1,
        role: 1,
        avatar: 1,
        color: 1,
        loggedOut: 1,
      },
    },
  ).fetch().reduce((result, user) => {
    const {
      userId,
      name,
      role,
      avatar,
      color,
      loggedOut,
    } = user;

    const status = connectionStatus.find(status => status.userId === userId);

    if (status) {
      result.push({
        name,
        avatar,
        offline: loggedOut,
        you: Auth.userID === userId,
        moderator: role === ROLE_MODERATOR,
        color,
        level: status.level,
        timestamp: status.timestamp,
      });
    }

    return result;
  }, []).sort(sortLevel).sort(sortOffline);
};

const isEnabled = () => STATS.enabled;

let roundTripTimeInterval = null;

const startRoundTripTime = () => {
  if (!isEnabled()) return;

  stopRoundTripTime();

  roundTripTimeInterval = setInterval(fetchRoundTripTime, STATS_INTERVAL);
};

const stopRoundTripTime = () => {
  if (roundTripTimeInterval) {
    clearInterval(roundTripTimeInterval);
  }
};

const isModerator = () => {
  const user = Users.findOne(
    {
      meetingId: Auth.meetingID,
      userId: Auth.userID,
    },
    { fields: { role: 1 } },
  );

  if (user && user.role === ROLE_MODERATOR) {
    return true;
  }

  return false;
};

if (STATS.enabled) {
  window.addEventListener('audiostats', handleAudioStatsEvent);
  window.addEventListener('socketstats', handleSocketStatsEvent);
}

const updateDataSavingSettings = (dataSaving, intl) => {
  if (!_.isEqual(Settings.dataSaving, dataSaving)) {
    Settings.dataSaving = dataSaving;
    Settings.save();
    if (intl) notify(intl.formatMessage(intlMessages.saved), 'info', 'settings');
  }
};

const getNotified = () => {
  const notified = Session.get('connectionStatusNotified');

  // Since notified can be undefined we need a boolean verification
  return notified === true;
};

const notification = (level, intl) => {
  if (!NOTIFICATION[level]) return null;

  // Avoid toast spamming
  const notified = getNotified();
  if (notified) {
    return null;
  }
  Session.set('connectionStatusNotified', true);


  if (intl) notify(intl.formatMessage(intlMessages.notification), level, 'warning');
};

export default {
  getConnectionStatus,
  getStats,
  getHelp,
  isEnabled,
  notification,
  startRoundTripTime,
  stopRoundTripTime,
  updateDataSavingSettings,
};
