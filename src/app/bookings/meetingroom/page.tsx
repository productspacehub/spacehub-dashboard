import { TimeSlotBookingList } from "@/components/bookings/TimeSlotBookingList";

export default function MeetingRoomBookingsPage() {
  return (
    <TimeSlotBookingList
      moduleType="meeting_room"
      moduleLabel="Meeting Room"
      newHref="/bookings/meetingroom/new"
      resourcesHref="/bookings/meetingroom/resources"
      addonsHref="/bookings/meetingroom/addons"
      ratesHref="/bookings/meetingroom/rates"
    />
  );
}
