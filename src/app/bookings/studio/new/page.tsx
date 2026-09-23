import { NewBookingForm } from "@/components/bookings/NewBookingForm";

export default function NewStudioBookingPage() {
  return (
    <NewBookingForm
      moduleType="studio"
      moduleLabel="Studio"
      backHref="/bookings/studio"
      ratesHref="/bookings/studio/rates"
      addonsHref="/bookings/studio/addons"
      usesTimeSlots
      resourcesHref="/bookings/studio/resources"
    />
  );
}
