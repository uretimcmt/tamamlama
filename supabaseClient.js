// supabaseClient.js

// Supabase istemcisini bir kez oluşturup dışa aktarıyoruz.
// Böylece projenin herhangi bir yerinden aynı istemciyi kullanabiliriz.
const supabaseUrl = 'https://hgrgsuaivjjggwbixlsy.supabase.co';
//const supabaseKey = 'sb_publishable_VTKoB3SwRuG2EkcvhW538Q_21fPygJT';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhncmdzdWFpdmpqZ2d3Yml4bHN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1NTExNDQsImV4cCI6MjA4MjEyNzE0NH0.eLC4tfbD2WVuGB1xpv_vKhQ5QPTyBBO7vtL_JQzyzu8';


export const _supabase = supabase.createClient(supabaseUrl, supabaseKey);