import React, { useContext } from 'react';
import { makeCall } from '/imports/ui/services/api';
import { withTracker } from 'meteor/react-meteor-data';
import Presentations from '/imports/api/presentations';
import PresentationAreaService from '/imports/ui/components/presentation/service';
import Poll from '/imports/ui/components/poll/component';
import Service from './service';
import Auth from '/imports/ui/services/auth';
import { UsersContext } from '../components-data/users-context/context';

const CHAT_CONFIG = Meteor.settings.public.chat;
const PUBLIC_CHAT_KEY = CHAT_CONFIG.public_id;

const PollContainer = ({ ...props }) => {
  const usingUsersContext = useContext(UsersContext);
  const { users } = usingUsersContext;

  const usernames = {};

  Object.values(users[Auth.meetingID]).forEach((user) => {
    usernames[user.userId] = { userId: user.userId, name: user.name };
  });

  return <Poll {...props} usernames={usernames} />;
};

export default withTracker(() => {
  Meteor.subscribe('current-poll');

  const currentPresentation = Presentations.findOne({
    current: true,
  }, { fields: { podId: 1 } }) || {};

  const currentSlide = PresentationAreaService.getCurrentSlide(currentPresentation.podId);

  const pollId = currentSlide ? currentSlide.id : PUBLIC_CHAT_KEY;

  const startPoll = (type, question = '') => makeCall('startPoll', type, pollId, question);

  const startCustomPoll = (type, question = '', answers) => makeCall('startPoll', type, pollId, question, answers);

  const stopPoll = () => makeCall('stopPoll');

  return {
    currentSlide,
    amIPresenter: Service.amIPresenter(),
    pollTypes: Service.pollTypes,
    startPoll,
    startCustomPoll,
    stopPoll,
    publishPoll: Service.publishPoll,
    currentPoll: Service.currentPoll(),
    resetPollPanel: Session.get('resetPollPanel') || false,
    pollAnswerIds: Service.pollAnswerIds,
    isMeteorConnected: Meteor.status().connected,
  };
})(PollContainer);
