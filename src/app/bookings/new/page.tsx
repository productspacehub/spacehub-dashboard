import { NewBookingForm } from "@/components/bookings/NewBookingForm";

export default function NewSharedStorageBookingPage() {
  return (
    <NewBookingForm
      moduleType="shared_storage"
      moduleLabel="Shared Storage"
      backHref="/bookings"
      ratesHref="/bookings/rates"
      addonsHref="/bookings/addons"
      footnote="Container belum dipilih di sini — container ditetapkan saat barang benar-benar drop-off (dari halaman detail booking)."
    />
  );
}
