import { TimeSlotResourcesPage } from "@/components/bookings/TimeSlotResourcesPage";

export default function MeetingRoomResourcesPage() {
  return <TimeSlotResourcesPage moduleType="meeting_room" moduleLabel="Meeting Room" backHref="/bookings/meetingroom" />;
}
