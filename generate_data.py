import csv
import random

NUM_PEOPLE = 300
people = []

genders = ['M', 'F']
names_m = ['John', 'Michael', 'David', 'James', 'Robert', 'William', 'Joseph', 'Thomas', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Donald', 'Mark', 'Paul', 'Steven', 'Andrew', 'Kenneth', 'Joshua', 'Kevin', 'Brian', 'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary']
names_f = ['Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Nancy', 'Lisa', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia']
last_names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson']

def get_name(gender):
    if gender == 'M':
        return f"{random.choice(names_m)} {random.choice(last_names)}"
    else:
        return f"{random.choice(names_f)} {random.choice(last_names)}"

# ID from 1 to 300
for i in range(1, NUM_PEOPLE + 1):
    gender = random.choice(genders)
    people.append({
        'id': i,
        'gender': gender,
        'name': get_name(gender)
    })

males = [p['id'] for p in people if p['gender'] == 'M']
females = [p['id'] for p in people if p['gender'] == 'F']

# Create families with some couples to ensure step-relations as well as full siblings
couples = []
for _ in range(50):
    m = random.choice(males)
    f = random.choice(females)
    couples.append((m, f))

# Add some step-relations (same father, different mothers)
for _ in range(20):
    m = random.choice(males)
    f1 = random.choice(females)
    f2 = random.choice(females)
    couples.append((m, f1))
    couples.append((m, f2))
    
# Same mother, different fathers
for _ in range(20):
    m1 = random.choice(males)
    m2 = random.choice(males)
    f = random.choice(females)
    couples.append((m1, f))
    couples.append((m2, f))

for p in people:
    # 90% chance to pick parents from our created 'couples' pool to have siblings/step-siblings
    if random.random() < 0.9:
        f, m = random.choice(couples)
        # Avoid self being own parent
        while f == p['id'] or m == p['id']:
            f, m = random.choice(couples)
        p['father_id'] = f
        p['mother_id'] = m
    else:
        # Pick completely random parents
        f = random.choice(males)
        while f == p['id']:
            f = random.choice(males)
            
        m = random.choice(females)
        while m == p['id']:
            m = random.choice(females)
            
        p['father_id'] = f
        p['mother_id'] = m

# Write to CSV
with open('/home/gouse/Projects/VotePredict/data.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'Name', 'Father', 'Mother', 'Gender'])
    for p in people:
        writer.writerow([p['id'], p['name'], p['father_id'], p['mother_id'], p['gender']])

print("Generated data.csv successfully!")
