/* ============ FleetWorks — geo-india.js ============
   State -> district data for every Indian state/UT, and district -> town data
   for Tamil Nadu (FleetWorks' current operating market). Drives the cascading
   State / District / Town fields on the booking form.

   Scope is deliberate:
   - Districts: complete for all of India (as of the 2024-25 reorganisations —
     Rajasthan post-reversal at 41, Ladakh at 7). New districts get carved
     every year; extending a list here is a one-line change.
   - Towns: Tamil Nadu only, taluk-level. Other states fall back to a type-in
     town field rather than a dropdown that pretends to completeness. Every TN
     district list also ends with "Other" in the UI, because no town list is
     ever truly complete and a missing town must never block a booking. */

"use strict";

window.IN_DISTRICTS = {
  "Andhra Pradesh": ["Alluri Sitharama Raju", "Anakapalli", "Anantapur", "Annamayya", "Bapatla", "Chittoor", "Dr. B.R. Ambedkar Konaseema", "East Godavari", "Eluru", "Guntur", "Kakinada", "Krishna", "Kurnool", "Nandyal", "NTR", "Palnadu", "Parvathipuram Manyam", "Prakasam", "Sri Potti Sriramulu Nellore", "Sri Sathya Sai", "Srikakulam", "Tirupati", "Visakhapatnam", "Vizianagaram", "West Godavari", "YSR Kadapa"],
  "Arunachal Pradesh": ["Anjaw", "Changlang", "Dibang Valley", "East Kameng", "East Siang", "Itanagar Capital Complex", "Kamle", "Kra Daadi", "Kurung Kumey", "Keyi Panyor", "Lepa Rada", "Lohit", "Longding", "Lower Dibang Valley", "Lower Siang", "Lower Subansiri", "Namsai", "Pakke-Kessang", "Papum Pare", "Shi-Yomi", "Siang", "Tawang", "Tirap", "Upper Siang", "Upper Subansiri", "West Kameng", "West Siang"],
  "Assam": ["Bajali", "Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup", "Kamrup Metropolitan", "Karbi Anglong", "Karimganj", "Kokrajhar", "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar", "Sonitpur", "South Salmara-Mankachar", "Tamulpur", "Tinsukia", "Udalguri", "West Karbi Anglong"],
  "Bihar": ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"],
  "Chhattisgarh": ["Balod", "Baloda Bazar", "Balrampur-Ramanujganj", "Bastar", "Bemetara", "Bijapur", "Bilaspur", "Dantewada", "Dhamtari", "Durg", "Gariaband", "Gaurela-Pendra-Marwahi", "Janjgir-Champa", "Jashpur", "Kabirdham", "Khairagarh-Chhuikhadan-Gandai", "Kanker", "Kondagaon", "Korba", "Korea", "Mahasamund", "Manendragarh-Chirmiri-Bharatpur", "Mohla-Manpur-Ambagarh Chowki", "Mungeli", "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sarangarh-Bilaigarh", "Sakti", "Sukma", "Surajpur", "Surguja"],
  "Goa": ["North Goa", "South Goa"],
  "Gujarat": ["Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha", "Bharuch", "Bhavnagar", "Botad", "Chhota Udaipur", "Dahod", "Dang", "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar", "Junagadh", "Kheda", "Kutch", "Mahisagar", "Mehsana", "Morbi", "Narmada", "Navsari", "Panchmahal", "Patan", "Porbandar", "Rajkot", "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad"],
  "Haryana": ["Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurugram", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat", "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"],
  "Himachal Pradesh": ["Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu", "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una"],
  "Jharkhand": ["Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum", "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribagh", "Jamtara", "Khunti", "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu", "Ramgarh", "Ranchi", "Sahibganj", "Seraikela-Kharsawan", "Simdega", "West Singhbhum"],
  "Karnataka": ["Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban", "Bidar", "Chamarajanagar", "Chikkaballapur", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysuru", "Raichur", "Ramanagara", "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayanagara", "Vijayapura", "Yadgir"],
  "Kerala": ["Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad"],
  "Madhya Pradesh": ["Agar Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat", "Barwani", "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur", "Chhindwara", "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna", "Gwalior", "Harda", "Hoshangabad (Narmadapuram)", "Indore", "Jabalpur", "Jhabua", "Katni", "Khandwa", "Khargone", "Maihar", "Mandla", "Mandsaur", "Mauganj", "Morena", "Narsinghpur", "Neemuch", "Niwari", "Pandhurna", "Panna", "Raisen", "Rajgarh", "Ratlam", "Rewa", "Sagar", "Satna", "Sehore", "Seoni", "Shahdol", "Shajapur", "Sheopur", "Shivpuri", "Sidhi", "Singrauli", "Tikamgarh", "Ujjain", "Umaria", "Vidisha"],
  "Maharashtra": ["Ahmednagar", "Akola", "Amravati", "Aurangabad (Chhatrapati Sambhajinagar)", "Beed", "Bhandara", "Buldhana", "Chandrapur", "Dhule", "Gadchiroli", "Gondia", "Hingoli", "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai City", "Mumbai Suburban", "Nagpur", "Nanded", "Nandurbar", "Nashik", "Osmanabad (Dharashiv)", "Palghar", "Parbhani", "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara", "Sindhudurg", "Solapur", "Thane", "Wardha", "Washim", "Yavatmal"],
  "Manipur": ["Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West", "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl", "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul"],
  "Meghalaya": ["East Garo Hills", "East Jaintia Hills", "East Khasi Hills", "Eastern West Khasi Hills", "North Garo Hills", "Ri-Bhoi", "South Garo Hills", "South West Garo Hills", "South West Khasi Hills", "West Garo Hills", "West Jaintia Hills", "West Khasi Hills"],
  "Mizoram": ["Aizawl", "Champhai", "Hnahthial", "Khawzawl", "Kolasib", "Lawngtlai", "Lunglei", "Mamit", "Saiha", "Saitual", "Serchhip"],
  "Nagaland": ["Chumoukedima", "Dimapur", "Kiphire", "Kohima", "Longleng", "Mokokchung", "Mon", "Niuland", "Noklak", "Peren", "Phek", "Shamator", "Tseminyu", "Tuensang", "Wokha", "Zunheboto"],
  "Odisha": ["Angul", "Balangir", "Balasore", "Bargarh", "Bhadrak", "Boudh", "Cuttack", "Deogarh", "Dhenkanal", "Gajapati", "Ganjam", "Jagatsinghpur", "Jajpur", "Jharsuguda", "Kalahandi", "Kandhamal", "Kendrapara", "Keonjhar", "Khordha", "Koraput", "Malkangiri", "Mayurbhanj", "Nabarangpur", "Nayagarh", "Nuapada", "Puri", "Rayagada", "Sambalpur", "Subarnapur", "Sundargarh"],
  "Punjab": ["Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib", "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar", "Kapurthala", "Ludhiana", "Malerkotla", "Mansa", "Moga", "Pathankot", "Patiala", "Rupnagar", "Sahibzada Ajit Singh Nagar (Mohali)", "Sangrur", "Shaheed Bhagat Singh Nagar", "Sri Muktsar Sahib", "Tarn Taran"],
  "Rajasthan": ["Ajmer", "Alwar", "Balotra", "Banswara", "Baran", "Barmer", "Beawar", "Bharatpur", "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Deeg", "Dholpur", "Didwana-Kuchaman", "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore", "Jhalawar", "Jhunjhunu", "Jodhpur", "Karauli", "Khairthal-Tijara", "Kota", "Kotputli-Behror", "Nagaur", "Pali", "Phalodi", "Pratapgarh", "Rajsamand", "Salumbar", "Sawai Madhopur", "Sikar", "Sirohi", "Sri Ganganagar", "Tonk", "Udaipur"],
  "Sikkim": ["Gangtok", "Gyalshing", "Mangan", "Namchi", "Pakyong", "Soreng"],
  "Tamil Nadu": ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kancheepuram", "Kanniyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar"],
  "Telangana": ["Adilabad", "Bhadradri Kothagudem", "Hanumakonda", "Hyderabad", "Jagtial", "Jangaon", "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar", "Khammam", "Komaram Bheem Asifabad", "Mahabubabad", "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri", "Mulugu", "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli", "Rajanna Sircilla", "Rangareddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal", "Yadadri Bhuvanagiri"],
  "Tripura": ["Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala", "South Tripura", "Unakoti", "West Tripura"],
  "Uttar Pradesh": ["Agra", "Aligarh", "Ambedkar Nagar", "Amethi", "Amroha", "Auraiya", "Ayodhya", "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur", "Banda", "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor", "Budaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar", "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur", "Hapur", "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi", "Kannauj", "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi", "Kheri", "Kushinagar", "Lalitpur", "Lucknow", "Maharajganj", "Mahoba", "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur", "Moradabad", "Muzaffarnagar", "Pilibhit", "Pratapgarh", "Prayagraj", "Raebareli", "Rampur", "Saharanpur", "Sambhal", "Sant Kabir Nagar", "Shahjahanpur", "Shamli", "Shravasti", "Siddharthnagar", "Sitapur", "Sonbhadra", "Sultanpur", "Unnao", "Varanasi"],
  "Uttarakhand": ["Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar", "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag", "Tehri Garhwal", "Udham Singh Nagar", "Uttarkashi"],
  "West Bengal": ["Alipurduar", "Bankura", "Birbhum", "Cooch Behar", "Dakshin Dinajpur", "Darjeeling", "Hooghly", "Howrah", "Jalpaiguri", "Jhargram", "Kalimpong", "Kolkata", "Malda", "Murshidabad", "Nadia", "North 24 Parganas", "Paschim Bardhaman", "Paschim Medinipur", "Purba Bardhaman", "Purba Medinipur", "Purulia", "South 24 Parganas", "Uttar Dinajpur"],
  "Andaman and Nicobar Islands": ["Nicobar", "North and Middle Andaman", "South Andaman"],
  "Chandigarh": ["Chandigarh"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Dadra and Nagar Haveli", "Daman", "Diu"],
  "Delhi": ["Central Delhi", "East Delhi", "New Delhi", "North Delhi", "North East Delhi", "North West Delhi", "Shahdara", "South Delhi", "South East Delhi", "South West Delhi", "West Delhi"],
  "Jammu and Kashmir": ["Anantnag", "Bandipora", "Baramulla", "Budgam", "Doda", "Ganderbal", "Jammu", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Poonch", "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian", "Srinagar", "Udhampur"],
  "Ladakh": ["Changthang", "Drass", "Kargil", "Leh", "Nubra", "Sham", "Zanskar"],
  "Lakshadweep": ["Lakshadweep"],
  "Puducherry": ["Karaikal", "Mahe", "Puducherry", "Yanam"],
};

// Tamil Nadu towns, taluk-level, keyed by district. "Other" is appended by the
// UI, not stored here.
window.TN_TOWNS = {
  "Ariyalur": ["Ariyalur", "Andimadam", "Jayankondam", "Sendurai", "Udayarpalayam"],
  "Chengalpattu": ["Chengalpattu", "Cheyyur", "Maduranthakam", "Pallavaram", "Tambaram", "Thiruporur", "Tirukalukundram", "Vandalur", "Guduvancheri"],
  "Chennai": ["Chennai", "Ambattur", "Alandur", "Aminjikarai", "Ayanavaram", "Egmore", "Guindy", "Madhavaram", "Mambalam", "Mylapore", "Perambur", "Purasawalkam", "Sholinganallur", "Tondiarpet", "Velachery", "Manali", "Ennore"],
  "Coimbatore": ["Coimbatore", "Annur", "Kinathukadavu", "Madukkarai", "Mettupalayam", "Perur", "Pollachi", "Sulur", "Valparai", "Anaimalai"],
  "Cuddalore": ["Cuddalore", "Bhuvanagiri", "Chidambaram", "Kattumannarkoil", "Kurinjipadi", "Neyveli", "Panruti", "Tittakudi", "Veppur", "Virudhachalam"],
  "Dharmapuri": ["Dharmapuri", "Harur", "Karimangalam", "Nallampalli", "Palacode", "Pappireddipatti", "Pennagaram"],
  "Dindigul": ["Dindigul", "Athoor", "Gujiliamparai", "Kodaikanal", "Natham", "Nilakottai", "Oddanchatram", "Palani", "Vedasandur"],
  "Erode": ["Erode", "Anthiyur", "Bhavani", "Gobichettipalayam", "Kodumudi", "Modakurichi", "Nambiyur", "Perundurai", "Sathyamangalam", "Thalavadi"],
  "Kallakurichi": ["Kallakurichi", "Chinnasalem", "Kalvarayan Hills", "Sankarapuram", "Tirukoilur", "Ulundurpet"],
  "Kancheepuram": ["Kancheepuram", "Kundrathur", "Sriperumbudur", "Uthiramerur", "Walajabad"],
  "Kanniyakumari": ["Nagercoil", "Agastheeswaram", "Colachel", "Kalkulam", "Killiyoor", "Thiruvattar", "Thovalai", "Vilavancode", "Marthandam"],
  "Karur": ["Karur", "Aravakurichi", "Kadavur", "Krishnarayapuram", "Kulithalai", "Manmangalam", "Pugalur"],
  "Krishnagiri": ["Krishnagiri", "Anchetty", "Bargur", "Denkanikottai", "Hosur", "Pochampalli", "Shoolagiri", "Uthangarai"],
  "Madurai": ["Madurai", "Melur", "Peraiyur", "Thirumangalam", "Thiruparankundram", "Usilampatti", "Vadipatti"],
  "Mayiladuthurai": ["Mayiladuthurai", "Kuthalam", "Sirkazhi", "Tharangambadi"],
  "Nagapattinam": ["Nagapattinam", "Kilvelur", "Thirukkuvalai", "Vedaranyam"],
  "Namakkal": ["Namakkal", "Kolli Hills", "Komarapalayam", "Kumarapalayam", "Mohanur", "Paramathi-Velur", "Rasipuram", "Sendamangalam", "Tiruchengode"],
  "Nilgiris": ["Udhagamandalam (Ooty)", "Coonoor", "Gudalur", "Kotagiri", "Kundah", "Pandalur"],
  "Perambalur": ["Perambalur", "Alathur", "Kunnam", "Veppanthattai"],
  "Pudukkottai": ["Pudukkottai", "Alangudi", "Aranthangi", "Avudaiyarkoil", "Gandarvakottai", "Illuppur", "Karambakudi", "Kulathur", "Manamelkudi", "Ponnamaravathi", "Thirumayam"],
  "Ramanathapuram": ["Ramanathapuram", "Kadaladi", "Kamuthi", "Kilakarai", "Mudukulathur", "Paramakudi", "Rameswaram", "Tiruvadanai"],
  "Ranipet": ["Ranipet", "Arakkonam", "Arcot", "Nemili", "Sholinghur", "Walajapet"],
  "Salem": ["Salem", "Attur", "Edappadi", "Gangavalli", "Mettur", "Omalur", "Pethanaickenpalayam", "Sankagiri", "Vazhapadi", "Yercaud"],
  "Sivaganga": ["Sivaganga", "Devakottai", "Ilayangudi", "Kalaiyarkoil", "Karaikudi", "Manamadurai", "Singampunari", "Tirupathur (Sivaganga)"],
  "Tenkasi": ["Tenkasi", "Alangulam", "Kadayanallur", "Sankarankovil", "Shenkottai", "Sivagiri", "Thiruvengadam", "Veerakeralampudur"],
  "Thanjavur": ["Thanjavur", "Budalur", "Kumbakonam", "Orathanadu", "Papanasam", "Pattukkottai", "Peravurani", "Thiruvaiyaru", "Thiruvidaimarudur"],
  "Theni": ["Theni", "Andipatti", "Bodinayakanur", "Periyakulam", "Uthamapalayam", "Cumbum"],
  "Thoothukudi": ["Thoothukudi", "Eral", "Ettayapuram", "Kayathar", "Kovilpatti", "Ottapidaram", "Sathankulam", "Srivaikuntam", "Tiruchendur", "Vilathikulam"],
  "Tiruchirappalli": ["Tiruchirappalli", "Lalgudi", "Manachanallur", "Manapparai", "Marungapuri", "Musiri", "Srirangam", "Thiruverumbur", "Thottiyam", "Thuraiyur"],
  "Tirunelveli": ["Tirunelveli", "Ambasamudram", "Cheranmahadevi", "Manur", "Nanguneri", "Palayamkottai", "Radhapuram"],
  "Tirupathur": ["Tirupathur", "Ambur", "Natrampalli", "Vaniyambadi"],
  "Tiruppur": ["Tiruppur", "Avinashi", "Dharapuram", "Kangeyam", "Madathukulam", "Palladam", "Udumalaipettai", "Uthukuli"],
  "Tiruvallur": ["Tiruvallur", "Avadi", "Gummidipoondi", "Pallipattu", "Ponneri", "Poonamallee", "Red Hills", "Tiruttani", "Uthukottai", "Padiyanallur"],
  "Tiruvannamalai": ["Tiruvannamalai", "Arani", "Chengam", "Chetpet", "Cheyyar", "Jamunamarathur", "Kalasapakkam", "Kilpennathur", "Polur", "Vandavasi", "Vembakkam"],
  "Tiruvarur": ["Tiruvarur", "Kodavasal", "Koothanallur", "Mannargudi", "Nannilam", "Needamangalam", "Thiruthuraipoondi", "Valangaiman"],
  "Vellore": ["Vellore", "Anaicut", "Gudiyatham", "Katpadi", "K.V. Kuppam", "Pernambut"],
  "Viluppuram": ["Viluppuram", "Gingee", "Kandachipuram", "Marakkanam", "Melmalayanur", "Thiruvennainallur", "Tindivanam", "Vanur", "Vikravandi"],
  "Virudhunagar": ["Virudhunagar", "Aruppukkottai", "Kariapatti", "Rajapalayam", "Sattur", "Sivakasi", "Srivilliputhur", "Tiruchuli", "Watrap"],
};
