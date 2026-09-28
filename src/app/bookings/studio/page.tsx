import { TimeSlotBookingList } from "@/components/bookings/TimeSlotBookingList";

export default function StudioBookingsPage() {
  return (
    <TimeSlotBookingList
      moduleType="studio"
      moduleLabel="Studio"
      newHref="/bookings/studio/new"
      resourcesHref="/bookings/studio/resources"
      addonsHref="/bookings/studio/addons"
      ratesHref="/bookings/studio/rates"
    />
  );
}
