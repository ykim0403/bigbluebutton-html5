import React, { useContext } from 'react';
import { withTracker } from 'meteor/react-meteor-data';
import MediaService, { getSwapLayout, shouldEnableSwapLayout } from '/imports/ui/components/media/service';
import { notify } from '/imports/ui/services/notification';
import PresentationAreaService from './service';
import { Slides } from '/imports/api/slides';
import PresentationArea from './component';
import PresentationToolbarService from './presentation-toolbar/service';
import { UsersContext } from '../components-data/users-context/context';
import Auth from '/imports/ui/services/auth';
import Meetings from '/imports/api/meetings';
import getFromUserSettings from '/imports/ui/services/users-settings';
import WhiteboardService from '/imports/ui/components/whiteboard/service';

const ROLE_VIEWER = Meteor.settings.public.user.role_viewer;

const PresentationAreaContainer = ({ presentationPodIds, mountPresentationArea, ...props }) => {
  const { layoutSwapped, podId } = props;

  const usingUsersContext = useContext(UsersContext);
  const { users } = usingUsersContext;
  const currentUser = users[Auth.meetingID][Auth.userID];

  const userIsPresenter = (podId === 'DEFAULT_PRESENTATION_POD') ? currentUser.presenter : props.isPresenter;

  return mountPresentationArea
    && (
      <PresentationArea
        {
        ...{
          ...props,
          isViewer: currentUser.role === ROLE_VIEWER,
          userIsPresenter: userIsPresenter && !layoutSwapped,
        }
        }
      />
    );
};

const APP_CONFIG = Meteor.settings.public.app;
const PRELOAD_NEXT_SLIDE = APP_CONFIG.preloadNextSlides;
const fetchedpresentation = {};

export default withTracker(({ podId }) => {
  const currentSlide = PresentationAreaService.getCurrentSlide(podId);
  const presentationIsDownloadable = PresentationAreaService.isPresentationDownloadable(podId);
  const layoutSwapped = getSwapLayout() && shouldEnableSwapLayout();

  let slidePosition;
  if (currentSlide) {
    const {
      presentationId,
      id: slideId,
    } = currentSlide;
    slidePosition = PresentationAreaService.getSlidePosition(podId, presentationId, slideId);
    if (PRELOAD_NEXT_SLIDE && !fetchedpresentation[presentationId]) {
      fetchedpresentation[presentationId] = {
        canFetch: true,
        fetchedSlide: {},
      };
    }
    const currentSlideNum = currentSlide.num;
    const presentation = fetchedpresentation[presentationId];

    if (PRELOAD_NEXT_SLIDE && !presentation.fetchedSlide[currentSlide.num + PRELOAD_NEXT_SLIDE] && presentation.canFetch) {
      const slidesToFetch = Slides.find({
        podId,
        presentationId,
        num: {
          $in: Array(PRELOAD_NEXT_SLIDE).fill(1).map((v, idx) => currentSlideNum + (idx + 1)),
        },
      }).fetch();

      const promiseImageGet = slidesToFetch
        .filter(s => !fetchedpresentation[presentationId].fetchedSlide[s.num])
        .map(async (slide) => {
          if (presentation.canFetch) presentation.canFetch = false;
          const image = await fetch(slide.imageUri);
          if (image.ok) {
            presentation.fetchedSlide[slide.num] = true;
          }
        });
      Promise.all(promiseImageGet).then(() => presentation.canFetch = true);
    }
  }
  return {
    currentSlide,
    slidePosition,
    downloadPresentationUri: PresentationAreaService.downloadPresentationUri(podId),
    isPresenter: PresentationAreaService.isPresenter(podId),
    multiUser: WhiteboardService.hasMultiUserAccess(currentSlide && currentSlide.id, Auth.userID)
      && !layoutSwapped,
    presentationIsDownloadable,
    mountPresentationArea: !!currentSlide,
    currentPresentation: PresentationAreaService.getCurrentPresentation(podId),
    notify,
    zoomSlide: PresentationToolbarService.zoomSlide,
    podId,
    layoutSwapped,
    toggleSwapLayout: MediaService.toggleSwapLayout,
    publishedPoll: Meetings.findOne({ meetingId: Auth.meetingID }, {
      fields: {
        publishedPoll: 1,
      },
    }).publishedPoll,
    currentPresentationId: Session.get('currentPresentationId') || null,
    restoreOnUpdate: getFromUserSettings(
      'bbb_force_restore_presentation_on_new_events',
      Meteor.settings.public.presentation.restoreOnUpdate,
    ),
  };
})(PresentationAreaContainer);
