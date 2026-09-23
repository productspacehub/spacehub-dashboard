import { NewBookingForm } from "@/components/bookings/NewBookingForm";

export default function NewMeetingRoomBookingPage() {
  return (
    <NewBookingForm
      moduleType="meeting_room"
      moduleLabel="Meeting Room"
      backHref="/bookings/meetingroom"
      ratesHref="/bookings/meetingroom/rates"
      addonsHref="/bookings/meetingroom/addons"
      usesTimeSlots
      resourcesHref="/bookings/meetingroom/resources"
    />
  );
}
