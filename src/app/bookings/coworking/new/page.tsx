import { NewBookingForm } from "@/components/bookings/NewBookingForm";

export default function NewCoworkingBookingPage() {
  return (
    <NewBookingForm
      moduleType="co_working"
      moduleLabel="Co-working"
      backHref="/bookings/coworking"
      ratesHref="/bookings/coworking/rates"
      addonsHref="/bookings/coworking/addons"
    />
  );
}
